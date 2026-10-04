/*
 * Five on Five, public edition: answers the page's /api/* calls from static files.
 *
 * scripts/export_static.py writes the files under data/. Most calls just return one
 * of them. The ones that take free-form parameters (Games filters, the Scores day,
 * a team's game list, the Standings "as of" date) are answered here from the
 * per-season files. Nothing here ranks a table: standings come pre-computed for every
 * game day by the same Python the private site uses, and this file only regroups them.
 *
 * The pure functions are exported for Node so a parity check can compare every
 * answer with the private site's API (scripts/tests/static_parity.py).
 */
(function (root) {
    "use strict";

    // ------------------------------------------------------------------ loading

    const state = { loader: defaultLoader, cache: new Map() };

    function defaultLoader(path) {
        const cfg = root.FIVE_STATIC || {};
        const stamp = cfg.builtAt ? `?v=${encodeURIComponent(cfg.builtAt)}` : "";
        return fetch(`${cfg.dataRoot || "data/"}${path}${stamp}`).then((res) => {
            if (!res.ok) throw new Error(`${path} ${res.status}`);
            return res.json();
        });
    }

    function load(path) {
        if (!state.cache.has(path)) {
            state.cache.set(
                path,
                Promise.resolve(state.loader(path)).catch((err) => {
                    state.cache.delete(path);
                    throw err;
                })
            );
        }
        return state.cache.get(path);
    }

    function configure(options) {
        if (options.loader) state.loader = options.loader;
        state.cache.clear();
    }

    // ------------------------------------------------------------------ small helpers

    function intParam(params, name) {
        const raw = params.get(name);
        if (raw === null || raw === "") return null;
        const n = Number.parseInt(raw, 10);
        return Number.isNaN(n) ? null : n;
    }

    function validDate(value) {
        if (!value) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (!m) return null;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        const iso = d.toISOString().slice(0, 10);
        return iso === `${m[1]}-${m[2]}-${m[3]}` ? iso : null;
    }

    function addDays(iso, offset) {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
    }

    function byGameId(a, b) {
        return a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : 0;
    }

    // Upcoming games sort by start time, then id; results have no start time and sort by id.
    function byStartThenId(a, b) {
        const x = a.start_time || "";
        const y = b.start_time || "";
        return x < y ? -1 : x > y ? 1 : byGameId(a, b);
    }

    async function catalogueSeason() {
        return (await load("meta.json")).catalogue_season;
    }

    async function seasonOf(params) {
        return intParam(params, "season") || (await catalogueSeason());
    }

    async function seasonRows(season) {
        return (await load(`games/${season}.json`)).games;
    }

    async function allRows() {
        const meta = await load("meta.json");
        const parts = await Promise.all(meta.seasons.slice().sort((a, b) => a - b).map(seasonRows));
        return [].concat(...parts);
    }

    // ------------------------------------------------------------------ Games

    function filterGames(rows, opts) {
        const team = opts.team ? String(opts.team).trim().toUpperCase() : "";
        const needle = (opts.query || "").trim().toLowerCase();
        const status = (opts.status || "").trim();
        return rows.filter((row) => {
            if (opts.season != null && Number(row.season) !== Number(opts.season)) return false;
            if (status && row.status !== status) return false;
            if (opts.gameType && row.game_type !== opts.gameType) return false;
            if (team && row.away_abbr !== team && row.home_abbr !== team) return false;
            if (needle) {
                const blob = ["away_name", "home_name", "away_abbr", "home_abbr", "game_date"]
                    .map((key) => String(row[key] || ""))
                    .join(" ")
                    .toLowerCase();
                if (!blob.includes(needle)) return false;
            }
            return true;
        });
    }

    function paginate(rows, page, perPage) {
        const total = rows.length;
        perPage = Math.max(1, Math.min(Number(perPage), 100));
        const pages = total ? Math.max(1, Math.ceil(total / perPage)) : 1;
        page = Math.max(1, Math.min(Number(page), pages));
        const start = (page - 1) * perPage;
        return { data: rows.slice(start, start + perPage), pagination: { page, per_page: perPage, total, pages } };
    }

    async function gamesPayload(params) {
        const season = intParam(params, "season");
        const rows = season != null ? await seasonRows(season) : await allRows();
        const filtered = filterGames(rows, {
            season,
            status: params.get("status"),
            team: params.get("team"),
            gameType: params.get("game_type"),
            query: params.get("q"),
        }).reverse();
        return paginate(filtered, intParam(params, "page") || 1, intParam(params, "per_page") || 25);
    }

    async function gameById(id) {
        const guess = Number.parseInt(String(id).slice(0, 4), 10);
        if (!Number.isNaN(guess)) {
            try {
                const hit = (await seasonRows(guess)).find((row) => row.game_id === id);
                if (hit) return hit;
            } catch (err) {
                /* fall through to the full scan */
            }
        }
        const hit = (await allRows()).find((row) => row.game_id === id);
        if (!hit) throw new Error("game not found");
        return hit;
    }

    // ------------------------------------------------------------------ Teams

    function teamGameView(row, abbr) {
        const isHome = row.home_abbr === abbr;
        const scored = isHome ? row.home_goals : row.away_goals;
        const allowed = isHome ? row.away_goals : row.home_goals;
        let result = null;
        if (scored !== null && scored !== undefined && allowed !== null && allowed !== undefined) {
            if (row.home_win === null || row.home_win === undefined) {
                result = scored === allowed ? "T" : scored > allowed ? "W" : "L";
            } else {
                const won = isHome ? row.home_win === 1 : row.home_win === 0;
                result = won ? "W" : "L";
            }
        }
        return Object.assign({}, row, {
            is_home: isHome,
            scored,
            allowed,
            xg_5v5: isHome ? row.home_xg_5v5 : row.away_xg_5v5,
            opponent: isHome ? row.away_abbr : row.home_abbr,
            opponent_name: isHome ? row.away_name : row.home_name,
            team_result: result,
        });
    }

    async function teamPayload(abbr, season) {
        const file = await load(`teams/${season}.json`);
        const key = String(abbr).trim().toUpperCase();
        const summary = file.summaries[key];
        if (!summary) throw new Error("unknown team");
        const games = (await seasonRows(season))
            .filter((row) => row.home_abbr === key || row.away_abbr === key)
            .map((row) => teamGameView(row, key));
        return Object.assign({}, summary, { games });
    }

    // ------------------------------------------------------------------ Standings

    function standingsPayload(series, view, asOf) {
        if (!series.dates.length) {
            // No game played yet: the table is every club on zero, in the view asked for.
            const key = series.views.some((v) => v.key === view) ? view : series.default_view;
            return Object.assign({}, series.empty[key], { as_of: validDate(asOf) });
        }
        const first = series.first_date;
        const last = series.last_date;
        let wanted = validDate(asOf);
        if (last && (wanted === null || wanted > last)) wanted = last;
        if (first && wanted !== null && wanted < first) wanted = first;
        const key = series.views.some((v) => v.key === view) ? view : series.default_view;
        let day = null;
        for (const d of series.dates) {
            if (d <= wanted) day = d;
            else break;
        }
        const snap = series.snaps[day];
        const cols = series.cols;
        const hydrate = (abbr, rank) => {
            const club = series.clubs[abbr];
            const packed = snap.rows[abbr];
            const row = { abbr, name: club.name, conference: club.conference, division: club.division };
            cols.forEach((col, i) => {
                row[col] = packed[i];
            });
            row.rank = rank;
            return row;
        };
        const groups = snap.views[key].map((group) => ({
            title: group.title,
            sections: group.sections.map((section) => ({
                title: section.title,
                rows: section.order.map((abbr, i) => hydrate(abbr, i + 1)),
                cut_after: section.cut_after,
            })),
        }));
        return {
            season: series.season,
            as_of: wanted,
            first_date: first,
            last_date: last,
            complete: snap.complete,
            in_progress: snap.in_progress,
            scheduled_games: series.scheduled_games,
            short_clubs: snap.short_clubs,
            games_counted: snap.games_counted,
            view: key,
            views: series.views,
            default_view: series.default_view,
            format: series.format,
            alignment: series.alignment,
            tiebreak_note: series.tiebreak_note,
            groups,
        };
    }

    async function standingsFor(params) {
        const season = await seasonOf(params);
        const series = await load(`standings/${season}.json`);
        return standingsPayload(series, params.get("view") || null, params.get("as_of") || null);
    }

    // ------------------------------------------------------------------ Scores

    const STRIP_DAYS = 3;
    const SCORE_FIELDS = [
        "game_id", "season", "game_date", "start_time", "game_type", "status", "home_abbr", "away_abbr",
        "home_name", "away_name", "home_goals", "away_goals", "home_win", "decided_in",
        "p_elo", "p_dc", "p_ml", "home_xg_5v5", "away_xg_5v5",
    ];

    function winnerHome(game) {
        if (game.home_win !== null && game.home_win !== undefined) return Boolean(game.home_win);
        const hg = game.home_goals;
        const ag = game.away_goals;
        if (hg === null || hg === undefined || ag === null || ag === undefined || hg === ag) return null;
        return hg > ag;
    }

    // W-L-OTL for each club going into `day`, regular season only (mirrors standings.records_before).
    function recordsBefore(rows, day) {
        const acc = {};
        const bump = (abbr, slot) => {
            const rec = (acc[abbr] = acc[abbr] || [0, 0, 0]);
            rec[slot] += 1;
        };
        for (const g of rows) {
            if (g.game_type !== "REG" || g.status !== "Finished") continue;
            const homeWon = winnerHome(g);
            if (homeWon === null) continue;
            if ((g.game_date || "") >= day) continue;
            const regulation = (g.decided_in || "REG") === "REG";
            bump(g.home_abbr, homeWon ? 0 : regulation ? 1 : 2);
            bump(g.away_abbr, homeWon ? (regulation ? 1 : 2) : 0);
        }
        const out = {};
        for (const [abbr, rec] of Object.entries(acc)) out[abbr] = `${rec[0]}-${rec[1]}-${rec[2]}`;
        return out;
    }

    function called(p, homeWin) {
        if (p === null || p === undefined || homeWin === null || homeWin === undefined || Math.abs(Number(p) - 0.5) < 1e-9) return null;
        return Number(p) > 0.5 === Boolean(homeWin);
    }

    function resolveDay(gamedays, day) {
        const asked = validDate(day);
        if (asked) return asked;
        if (gamedays.played.length) return gamedays.played[gamedays.played.length - 1];
        const all = Object.keys(gamedays.dates).sort();
        return all.length ? all[all.length - 1] : null;
    }

    function scoreboardPayload(gamedays, chosen, dayRows, seasonGames) {
        if (!chosen) return { date: null, games: [], strip: [], prev_date: null, next_date: null, n: 0 };
        const rows = dayRows.slice().sort(byStartThenId);
        const season = rows.length ? rows[0].season : null;
        const records = rows.length && rows.some((g) => g.game_type === "REG") ? recordsBefore(seasonGames, chosen) : {};
        const tally = { elo: [0, 0], dc: [0, 0], ml: [0, 0] };
        const games = rows.map((g) => {
            const item = {};
            SCORE_FIELDS.forEach((key) => {
                item[key] = g[key] === undefined ? null : g[key];
            });
            if (g.game_type === "REG") {
                item.home_record = records[g.home_abbr] || "0-0-0";
                item.away_record = records[g.away_abbr] || "0-0-0";
            } else {
                item.home_record = item.away_record = null;
            }
            if (g.status === "Finished") {
                for (const [label, key] of [["elo", "p_elo"], ["dc", "p_dc"], ["ml", "p_ml"]]) {
                    const hit = called(g[key], g.home_win);
                    if (hit !== null) {
                        tally[label][1] += 1;
                        tally[label][0] += hit ? 1 : 0;
                    }
                }
            }
            return item;
        });
        const strip = [];
        for (let offset = -STRIP_DAYS; offset <= STRIP_DAYS; offset++) {
            const stamp = addDays(chosen, offset);
            strip.push({ date: stamp, n: gamedays.dates[stamp] ? gamedays.dates[stamp][0] : 0, selected: offset === 0 });
        }
        const all = Object.keys(gamedays.dates).sort();
        let prev = null;
        let next = null;
        for (const d of all) {
            if (d < chosen) prev = d;
            else if (d > chosen) {
                next = d;
                break;
            }
        }
        return {
            date: chosen,
            season,
            n: games.length,
            finished: games.filter((g) => g.status === "Finished").length,
            games,
            strip,
            prev_date: prev,
            next_date: next,
            latest_date: gamedays.played.length ? gamedays.played[gamedays.played.length - 1] : null,
            called: {
                elo: { right: tally.elo[0], of: tally.elo[1] },
                dc: { right: tally.dc[0], of: tally.dc[1] },
                ml: { right: tally.ml[0], of: tally.ml[1] },
            },
        };
    }

    async function scoreboardFor(dayParam) {
        const gamedays = await load("gamedays.json");
        const chosen = resolveDay(gamedays, dayParam);
        if (!chosen) return scoreboardPayload(gamedays, null, [], []);
        const slot = gamedays.dates[chosen];
        const seasonGames = slot ? await seasonRows(slot[1]) : [];
        const dayRows = seasonGames.filter((g) => g.game_date === chosen);
        return scoreboardPayload(gamedays, chosen, dayRows, seasonGames);
    }

    // ------------------------------------------------------------------ Upcoming

    const UPCOMING_MAX_DAYS = 3;
    const UPCOMING_MAX_GAMES = 24;

    // Today's date in US Eastern time, which is how the NHL files a game under a day.
    function easternToday() {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        const get = (type) => parts.find((p) => p.type === type).value;
        return `${get("year")}-${get("month")}-${get("day")}`;
    }

    // Mirrors scripts/site/upcoming.py group_upcoming: the next game days on or after `today`.
    function groupUpcoming(fixtures, today) {
        const ahead = fixtures.filter((g) => g.game_date >= today);
        const days = [];
        let shown = 0;
        for (const g of ahead) {
            if (shown >= UPCOMING_MAX_GAMES) break;
            if (!days.length || days[days.length - 1].date !== g.game_date) {
                if (days.length >= UPCOMING_MAX_DAYS) break;
                days.push({ date: g.game_date, games: [] });
            }
            days[days.length - 1].games.push(g);
            shown += 1;
        }
        return { today, n: shown, more: ahead.length - shown, days };
    }

    async function upcomingFor(params) {
        const file = await load("upcoming.json");
        const today = validDate(params.get("today")) || easternToday();
        const out = groupUpcoming(file.fixtures, today);
        out.source = file.source === undefined ? null : file.source;
        return out;
    }

    // ------------------------------------------------------------------ Players and compare

    function playersPayload(file, query, team) {
        let rows = file.rows;
        const needle = (query || "").trim().toLowerCase();
        const teamKey = team ? String(team).trim().toUpperCase() : "";
        if (teamKey) rows = rows.filter((row) => row.team === teamKey);
        if (needle) {
            rows = rows.filter((row) => (row.name || "").toLowerCase().includes(needle) || (row.team || "").toLowerCase().includes(needle));
        }
        return { season: file.season, n: rows.length, note: file.note, teams: file.teams, data: rows.slice(0, 80), credit: file.credit };
    }

    async function playersFor(params) {
        const season = await seasonOf(params);
        return playersPayload(await load(`players/${season}.json`), params.get("q"), params.get("team"));
    }

    async function compareFor(params) {
        const season = await seasonOf(params);
        const file = await load(`compare/${season}.json`);
        const wanted = (params.get("teams") || "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        if (!wanted.length) return file;
        return { season: file.season, teams: file.teams.filter((t) => wanted.includes(t.abbr)) };
    }

    // ------------------------------------------------------------------ router

    async function get(url) {
        const u = new URL(url, "http://static.invalid");
        const path = u.pathname;
        const q = u.searchParams;
        let m;
        if (path === "/api/meta") return load("meta.json");
        if (path === "/api/predictions") return load("predictions.json");
        if (path === "/api/years") return load("years.json");
        if ((m = path.match(/^\/api\/season\/(\d+)$/))) return load(`season/${m[1]}.json`);
        if (path === "/api/teams") {
            const file = await load(`teams/${await seasonOf(q)}.json`);
            return { season: file.season, teams: file.teams };
        }
        if ((m = path.match(/^\/api\/teams\/([^/]+)$/))) return teamPayload(decodeURIComponent(m[1]), await seasonOf(q));
        if (path === "/api/games") return gamesPayload(q);
        if ((m = path.match(/^\/api\/games\/([^/]+)$/))) return gameById(decodeURIComponent(m[1]));
        if (path === "/api/standings") return standingsFor(q);
        if (path === "/api/scoreboard") return scoreboardFor(q.get("date"));
        if (path === "/api/upcoming") return upcomingFor(q);
        if (path === "/api/players") return playersFor(q);
        if (path === "/api/compare") return compareFor(q);
        throw new Error(`No static data for ${path}`);
    }

    const api = {
        get,
        configure,
        // exported for the parity check
        standingsPayload,
        scoreboardPayload,
        groupUpcoming,
        recordsBefore,
        teamGameView,
        filterGames,
        paginate,
        playersPayload,
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.FiveStatic = api;
})(typeof window !== "undefined" ? window : globalThis);
