const PLOT_LAYOUT = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Source Sans 3, Segoe UI, sans-serif", color: "#12202e" },
    margin: { t: 24, r: 16, b: 48, l: 48 },
};

let meta = null;
let predictions = null;
let matchesPage = 1;

// The public edition (GitHub Pages) has no server. static_api.js answers the same /api/* calls
// from pre-rendered files, and per-game closing-line fields are not part of that edition.
function isStaticMode() {
    return Boolean(window.FIVE_STATIC && window.FiveStatic);
}

async function fetchJSON(url) {
    if (isStaticMode() && url.startsWith("/api/")) return window.FiveStatic.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return res.json();
}

function seasonLabel(year) {
    if (year === null || year === undefined || year === "") return "";
    const start = Number(year);
    return `${start}–${String(start + 1).slice(-2)}`;
}

function kpiHtml(label, value, sub, cols = "col-6 col-md-3") {
    return `<div class="${cols}"><div class="kpi"><span class="kpi-label">${label}</span><p class="kpi-value">${value}</p><span class="kpi-sub">${sub || ""}</span></div></div>`;
}

function fmt(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return Number(value).toFixed(digits);
}

function pct(value, digits = 1) {
    if (value === null || value === undefined) return "—";
    return `${(Number(value) * 100).toFixed(digits)}%`;
}

// Escape anything that came from the API before it goes into innerHTML.
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function defaultSeason() {
    return meta.default_season ?? meta.catalogue_season;
}

function prettyDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function ordinal(n) {
    const suffix = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

// The data stores a shootout as a level score; the official final gives the winner one more.
function finalGoals(row) {
    let away = Number(row.away_goals);
    let home = Number(row.home_goals);
    if (row.decided_in === "SO" && row.home_win != null) {
        if (row.home_win === 1) home += 1;
        else away += 1;
    }
    return { away, home };
}

function scoreCell(row) {
    if (row.status !== "Finished") return `<span class="score-line">TBC</span>`;
    const { away, home } = finalGoals(row);
    const tag = row.decided_in === "OT" || row.decided_in === "SO" ? `<span class="score-ot">${row.decided_in}</span>` : "";
    return `<span class="score-line">${away}<span class="score-sep">–</span>${home}</span>${tag}`;
}

function statusPill(status) {
    const key = (status || "").toLowerCase();
    return `<span class="status-pill ${key}">${status || ""}</span>`;
}

const ERA_TITLES = {
    "2008-pre-realign": "Six-division era",
    "2012-lockout-48": "Lockout-shortened season (48 games)",
    "2013-realignment": "Four-division realignment",
    "2015-ot-3v3": "3-on-3 overtime era",
    "2017-vegas-31": "Vegas expansion (31 teams)",
    "2019-covid-truncation": "COVID-interrupted season",
    "2020-56-realign": "COVID realignment (56 games)",
    "2021-seattle-32": "Seattle expansion (32 teams)",
    "2025-olympic-break": "Olympic-break season",
    "pre-2008": "Before 2008-09",
};

function eraTitle(label) {
    return ERA_TITLES[label] || label || "";
}

function fillSeasonSelect(select, seasons, selected, allLabel) {
    if (!select) return;
    const all = allLabel ? `<option value="">${allLabel}</option>` : "";
    select.innerHTML =
        all +
        seasons
            .slice()
            .reverse()
            .map((year) => `<option value="${year}" ${Number(year) === Number(selected) ? "selected" : ""}>${seasonLabel(year)}</option>`)
            .join("");
}

function gamesTable(rows) {
    if (!rows.length) return "<p class='coverage-note mb-0'>No matches in this cut.</p>";
    const pub = isStaticMode();
    const prob = (v) => (v === null || v === undefined ? "—" : pct(v, 0));
    const body = rows
        .map(
            (row) => `<tr class="match-row" data-game-id="${esc(row.game_id)}">
            <td>${esc(row.game_date)}</td>
            <td><span class="d-none d-md-inline">${esc(row.away_name)} @ ${esc(row.home_name)}</span><span class="d-md-none">${esc(row.away_abbr)} @ ${esc(row.home_abbr)}</span></td>
            <td>${scoreCell(row)}</td>
            ${pub ? "" : `<td>${prob(row.p_home)}</td>`}
            <td${pub ? "" : ' class="d-none d-md-table-cell"'}>${prob(row.p_elo)}</td>
            <td class="d-none d-md-table-cell">${prob(row.p_dc)}</td>
            <td class="d-none d-md-table-cell">${prob(row.p_ml)}</td>
            ${pub ? "" : `<td class="d-none d-md-table-cell">${row.total_line ?? "—"}</td>`}
            <td class="d-none d-lg-table-cell">${row.playoff ? "Playoffs" : "Regular"}</td>
            <td class="d-none d-lg-table-cell">${statusPill(row.status)}</td>
        </tr>`
        )
        .join("");
    const head = [
        "<th>Date</th>",
        "<th>Match</th>",
        "<th>Score</th>",
        pub ? "" : '<th title="Closing line: vig-free home-win probability">C0</th>',
        `<th${pub ? "" : ' class="d-none d-md-table-cell"'} title="Elo home-win probability">Elo</th>`,
        '<th class="d-none d-md-table-cell" title="Dixon–Coles home-win probability">DC</th>',
        '<th class="d-none d-md-table-cell" title="Logistic regression home-win probability">ML</th>',
        pub ? "" : '<th class="d-none d-md-table-cell" title="Posted closing total (goals)">Total</th>',
        '<th class="d-none d-lg-table-cell">Type</th>',
        '<th class="d-none d-lg-table-cell"></th>',
    ].join("");
    return `<table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderMlCard(ml) {
    const lede = document.getElementById("pred-ml-lede");
    if (lede && ml.brier != null) {
        const diff = (d) => (d == null ? "—" : `${d > 0 ? "+" : ""}${fmt(d, 4)}`);
        const ci = (c) => (c ? ` (95% CI ${c.map((x) => fmt(x, 4)).join(" to ")})` : "");
        const oow = ml.out_of_window || {};
        const later = oow.ml && oow.ml.n && oow.elo && oow.elo.n
            ? ` On the ${oow.ml.n.toLocaleString()} games since (no close needed) it scores ${fmt(oow.ml.brier, 4)} against Elo ${fmt(oow.elo.brier, 4)}; that comparison was not part of the stamped test.`
            : "";
        lede.textContent = `Walk-forward Brier ${fmt(ml.brier, 4)} on ${ml.n?.toLocaleString() || "—"} games: ${diff(ml.vs_elo?.brier_diff)} against Elo${ci(ml.vs_elo?.brier_diff_ci95)}, ${diff(ml.vs_c0?.brier_diff)} against the close${ci(ml.vs_c0?.brier_diff_ci95)}. ${ml.vs_c0?.beats_reference ? "Beats the close." : "Does not beat the close."} No price is an input.${later} Not registered.`;
    }
    const table = document.getElementById("pred-ml-table");
    if (table) {
        table.innerHTML = `<table class="table"><tbody>
            <tr><th>n</th><td>${ml.n?.toLocaleString() || "—"}</td></tr>
            <tr><th>Logistic Brier</th><td>${fmt(ml.brier, 4)}</td></tr>
            <tr><th>Elo Brier</th><td>${fmt(ml.elo_brier, 4)}</td></tr>
            <tr><th>Base-rate Brier</th><td>${fmt(ml.base_rate_brier, 4)}</td></tr>
            <tr><th>C0 Brier</th><td>${fmt(ml.c0_brier, 4)}</td></tr>
            <tr><th>Brier vs Elo</th><td>${fmt(ml.vs_elo?.brier_diff, 4)}</td></tr>
            <tr><th>Brier vs C0</th><td>${fmt(ml.vs_c0?.brier_diff, 4)}</td></tr>
            <tr><th>Live penalty λ</th><td>${ml.selected?.lambda ?? "—"}</td></tr>
            <tr><th>Registered</th><td>${ml.registered ? "yes" : "no"}</td></tr>
        </tbody></table>`;
    }
    const coefs = document.getElementById("pred-ml-coefs");
    const entries = Object.entries(ml.selected?.coef || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (coefs && entries.length) {
        coefs.innerHTML = `<table class="table"><thead><tr><th>Input (live fit)</th><th>Weight, standardised</th></tr></thead><tbody>${entries
            .map(([name, value]) => `<tr><td>${esc(name)}</td><td>${value > 0 ? "+" : ""}${fmt(value, 3)}</td></tr>`)
            .join("")}</tbody></table>`;
    }
}

function bindMatchRows(root) {
    root.querySelectorAll(".match-row").forEach((tr) => {
        tr.addEventListener("click", () => openMatch(tr.getAttribute("data-game-id")));
    });
}

async function openMatch(gameId) {
    const pub = isStaticMode();
    const row = await fetchJSON(`/api/games/${encodeURIComponent(gameId)}`);
    if (!row) return;
    document.getElementById("match-modal-title").textContent = `${row.away_name} at ${row.home_name}`;
    document.getElementById("match-modal-body").innerHTML = `
        <p class="coverage-note">${esc(row.game_date)}${row.start_time && row.status !== "Finished" ? ` · starts ${esc(startLabel(row.start_time))}` : ""} · ${seasonLabel(row.season)} · ${esc(eraTitle(row.era_label))}${row.game_type === "PLA" ? " · Playoffs" : ""}</p>
        <p class="score-line mb-3">${scoreCell(row)}</p>
        <dl class="row mb-0">
            ${pub ? "" : `<dt class="col-sm-4">C0 P(home win)</dt><dd class="col-sm-8">${row.p_home == null ? "No joined close" : pct(row.p_home, 1)}</dd>`}
            <dt class="col-sm-4">Elo P(home win)</dt><dd class="col-sm-8">${row.p_elo == null ? "—" : pct(row.p_elo, 1)}</dd>
            <dt class="col-sm-4">Elo ratings</dt><dd class="col-sm-8">${row.elo_away == null ? "—" : fmt(row.elo_away, 0)} away · ${row.elo_home == null ? "—" : fmt(row.elo_home, 0)} home${row.elo_home_ice == null ? "" : ` · +${fmt(row.elo_home_ice, 0)} home ice`}</dd>
            <dt class="col-sm-4">Dixon–Coles P(home win)</dt><dd class="col-sm-8">${row.p_dc == null ? "—" : pct(row.p_dc, 1)}</dd>
            <dt class="col-sm-4">Dixon–Coles λ</dt><dd class="col-sm-8">${row.dc_lam_away == null ? "—" : `${fmt(row.dc_lam_away, 2)} away · ${fmt(row.dc_lam_home, 2)} home`}</dd>
            <dt class="col-sm-4">Logistic P(home win)</dt><dd class="col-sm-8">${row.p_ml == null ? "—" : pct(row.p_ml, 1)}</dd>
            ${pub ? "" : `<dt class="col-sm-4">Posted total</dt><dd class="col-sm-8">${esc(row.total_line ?? "—")}</dd>`}
            ${row.status === "Finished" ? `<dt class="col-sm-4">5v5 xG</dt><dd class="col-sm-8">${fmt(row.away_xg_5v5, 2)} – ${fmt(row.home_xg_5v5, 2)}</dd>
            <dt class="col-sm-4">Empty-net</dt><dd class="col-sm-8">away ${row.away_eng ?? 0} · home ${row.home_eng ?? 0}</dd>
            <dt class="col-sm-4">Extra time</dt><dd class="col-sm-8">${{ OT: "Overtime", SO: "Shootout" }[row.decided_in] || "Regulation"}</dd>` : ""}
        </dl>
        <p class="coverage-note mt-3 mb-0">${row.status !== "Finished" ? "Not played yet. Elo and Dixon–Coles are this site's own models, priced from the results so far." : pub ? "MoneyPuck xG. Elo and Dixon–Coles are this site's own models. Closing-line prices are not published here." : "MoneyPuck xG. Archive moneylines are not displayed."}</p>`;
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("match-modal"));
    modal.show();
}

function goldLine() {
    return { line: { color: "#c4a35a", dash: "dash" } };
}

function renderHomeNotes(c0) {
    const note = document.getElementById("home-model-note");
    if (!note) return;
    const seasons = meta.eval_seasons || [];
    const window_ = seasons.length ? `${seasons[0]}–${seasons[seasons.length - 1]}` : "the eval window";
    const spent = (meta.registered_challengers || []).length;
    const sel = meta.elo?.selected || {};
    const parts = [
        isStaticMode()
            ? `C0 is the posted closing line, not a learned model. It is scored here in aggregate only: binary home-win Brier ${fmt(c0.brier, 4)} on ${c0.n?.toLocaleString() || "—"} games, ${window_}. Per-game closing prices are not published.`
            : `C0 is the posted close, not a learned model. Binary home-win Brier ${fmt(c0.brier, 4)} on ${c0.n?.toLocaleString() || "—"} games, ${window_}.`,
        c0.always_home_brier != null ? `Always-home is ${fmt(c0.always_home_brier, 4)}, which is a yardstick and not the bar to clear.` : "",
        `Elo is a sequential ratings model${sel.home_ice != null ? ` with a ${sel.home_ice}-point home-ice boost` : ""}; it is not registered.`,
        "Dixon–Coles is a bivariate Poisson with previous-game starter GSAx in the λs; it is not registered.",
        "The logistic model is a regularised regression on Elo, rest, travel, goalie and xG inputs, with no price as an input; it is not registered.",
        "Slot 1 shades the posted total from schedule density and did not clear.",
        `${(meta.k_max ?? 10) - spent} of ${meta.k_max ?? 10} ledger slots remain.`,
    ];
    note.textContent = parts.filter(Boolean).join(" ");
}

function renderCoverage() {
    const root = document.getElementById("home-coverage");
    const c = meta.coverage;
    if (!root || !c) return;
    const items = [
        `<li><strong>Results and xG</strong> from MoneyPuck, ${seasonLabel(meta.season_min)} to ${esc(prettyDate(c.last_game_date))}: ${meta.n_games?.toLocaleString() || "—"} games.</li>`,
        isStaticMode()
            ? `<li><strong>Closing-line scoring</strong> uses ${c.market_games?.toLocaleString() || "—"} games, ${seasonLabel(c.market_first_season)} to ${seasonLabel(c.market_last_season)}, from the Sportsbook Reviews Online archive, which is kept off this site. Only aggregate scores are published, never the prices themselves. Elo and Dixon–Coles price every game.</li>`
            : `<li><strong>Closing moneyline</strong> joined for ${c.market_games?.toLocaleString() || "—"} games, ${seasonLabel(c.market_first_season)} to ${seasonLabel(c.market_last_season)}. Games after that have no close and no C0 probability; Elo and Dixon–Coles still price them.</li>`,
        c.scheduled_games
            ? `<li><strong>Schedule</strong>: ${c.scheduled_games} upcoming ${c.scheduled_games === 1 ? "game is" : "games are"} listed, from a fixture list that carries no odds. Elo and Dixon–Coles price each one.</li>`
            : "<li><strong>Schedule</strong>: no upcoming games are listed right now. Results come from MoneyPuck; the fixture list is a separate, optional feed.</li>",
    ];
    if ((c.gaps || []).length) {
        items.push(
            `<li><strong>Missing games</strong>: ${c.gaps.map((g) => `${seasonLabel(g.season)} (${g.missing})`).join(", ")}. The source file lacks them, so those clubs show one game short.</li>`
        );
    }
    if (meta.default_season !== meta.catalogue_season) {
        items.push(
            `<li><strong>Live season</strong>: ${seasonLabel(meta.catalogue_season)} has ${c.newest_season_finished ?? "a few"} games so far. Pages open on ${seasonLabel(meta.default_season)} until a quarter of a schedule is in; pick the new season from any season menu.</li>`
        );
    }
    root.innerHTML = `<ul class="coverage-list mb-0">${items.join("")}</ul>`;
}

// ------------------------------------------------------------ Next up (landing page)

// Today's date in US Eastern time, which is how the NHL files a game under a day.
function easternToday() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}

// A start time in the viewer's own time zone, with the zone named so a late game is not misread.
function startLabel(iso) {
    const when = iso ? new Date(iso) : null;
    if (!when || Number.isNaN(when.getTime())) return "TBC";
    return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function dayHeading(iso, today) {
    const [y, m, d] = iso.split("-").map(Number);
    const stamp = Date.UTC(y, m - 1, d);
    const label = new Date(stamp).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const diff = Math.round((stamp - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return { label, tag: diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : "" };
}

// The side a model favours and its chance, from the home-win probability.
function favourite(game, p) {
    if (p === null || p === undefined || Number.isNaN(Number(p))) return null;
    const home = Number(p) >= 0.5;
    return { abbr: home ? game.home_abbr : game.away_abbr, prob: home ? Number(p) : 1 - Number(p) };
}

function fixtureModel(label, game, p, title) {
    const fav = favourite(game, p);
    const cls = { Elo: "fx-elo", DC: "fx-dc", ML: "fx-ml" }[label] || "fx-dc";
    if (!fav) return `<span class="fx-model ${cls} fx-empty"><span class="fx-model-label">${label}</span><span class="fx-model-pick">—</span></span>`;
    return `<span class="fx-model ${cls}" title="${esc(title)}: ${esc(game.home_abbr)} ${pct(p, 1)} to win at home"><span class="fx-model-label">${label}</span><span class="fx-model-pick"><strong>${esc(fav.abbr)}</strong> ${pct(fav.prob, 0)}</span><span class="prob-bar"><i style="width:${(fav.prob * 100).toFixed(1)}%"></i></span></span>`;
}

function fixtureRow(game) {
    const a = favourite(game, game.p_elo);
    const b = favourite(game, game.p_dc);
    const split = a && b && a.abbr !== b.abbr ? `<span class="fx-split" title="Elo and Dixon–Coles favour different sides">split</span>` : "";
    const playoff = game.game_type === "PLA" ? `<span class="fx-kind">Playoffs</span>` : "";
    return `<div class="fx-row" role="button" tabindex="0" data-game-id="${esc(game.game_id)}">
        <span class="fx-time">${esc(startLabel(game.start_time))}</span>
        <span class="fx-teams"><strong>${esc(game.away_abbr)}</strong><span class="fx-name d-none d-lg-inline"> ${esc(game.away_name)}</span> <span class="fx-at">@</span> <strong>${esc(game.home_abbr)}</strong><span class="fx-name d-none d-lg-inline"> ${esc(game.home_name)}</span>${playoff}${split}</span>
        ${fixtureModel("Elo", game, game.p_elo, "Elo with home ice")}
        ${fixtureModel("DC", game, game.p_dc, "Dixon–Coles")}
        ${fixtureModel("ML", game, game.p_ml, "Logistic regression")}
    </div>`;
}

function fixtureSource(source) {
    if (!source || !source.name) return "";
    const link = source.url ? `<a href="${esc(source.url)}" rel="noopener">${esc(source.name)}</a>` : esc(source.name);
    const fetched = source.fetched_at ? new Date(source.fetched_at) : null;
    const known = fetched && !Number.isNaN(fetched.getTime());
    const stale = known && Date.now() - fetched.getTime() > 3 * 86400000;
    const when = known ? fetched.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
    return `<span class="fx-source${stale ? " is-stale" : ""}">Fixtures from ${link}${when ? `, fetched ${esc(when)}` : ""}${stale ? ". This list may be out of date" : ""}</span>`;
}

function upcomingEmpty(payload) {
    if (!payload.source) {
        return isStaticMode()
            ? "No fixture list has been published yet."
            : "No fixture list is loaded. Run <code>python -m scripts.ingest.fixtures</code> to fetch one.";
    }
    return "No games are listed from today on. The NHL may be between seasons, or the list needs a refresh.";
}

async function renderUpcoming() {
    const root = document.getElementById("home-upcoming");
    if (!root) return;
    let payload;
    try {
        payload = await fetchJSON(`/api/upcoming?today=${easternToday()}`);
    } catch (err) {
        root.innerHTML = "";
        return;
    }
    // The page may have been open (or the data published) a while: a game that has begun is not "next up".
    const now = Date.now();
    const days = (payload.days || [])
        .map((day) => ({ date: day.date, games: day.games.filter((g) => !g.start_time || Date.parse(g.start_time) > now) }))
        .filter((day) => day.games.length);
    const shown = days.reduce((sum, day) => sum + day.games.length, 0);
    // The panel opens on the next game day (and the one after, if the first is a short slate);
    // the rest of the fetched window is a click away so the landing page stays short.
    let open = 0;
    let visible = 0;
    while (open < days.length && (open === 0 || visible < 6)) visible += days[open++].games.length;
    const hidden = days.slice(open);
    const hiddenGames = hidden.reduce((sum, day) => sum + day.games.length, 0);
    const dayHtml = (day, i) => {
        const head = dayHeading(day.date, payload.today);
        return `<div class="fx-day-block${i >= open ? " fx-later" : ""}"${i >= open ? " hidden" : ""}><h3 class="fx-day">${esc(head.label)}${head.tag ? `<span class="fx-day-tag">${head.tag}</span>` : ""}<small>${day.games.length} ${day.games.length === 1 ? "game" : "games"}</small></h3>
            <div class="fx-list">${day.games.map(fixtureRow).join("")}</div></div>`;
    };
    const body = days.length ? days.map(dayHtml).join("") : `<p class="coverage-note mb-0">${upcomingEmpty(payload)}</p>`;
    const toggle = hidden.length
        ? `<button type="button" class="btn btn-outline-secondary btn-sm fx-toggle" aria-expanded="false">Show ${hiddenGames} more ${hiddenGames === 1 ? "game" : "games"} on the next ${hidden.length === 1 ? "day" : `${hidden.length} days`}</button>`
        : "";
    const more = days.length && payload.more > 0 ? `<p class="fx-more">${payload.more} more ${payload.more === 1 ? "game is" : "games are"} listed further ahead; open <a href="#scores" data-section="scores">Scores</a> and step forward by day.</p>` : "";
    const note = days.length
        ? `<p class="coverage-note fx-note">The chance shown is the favoured side's, from this site's own Elo and Dixon–Coles models: ratings and strengths built from past results and MoneyPuck expected goals, using the home side's advantage. A bar is that chance; “split” marks games where the two disagree. Neither is a registered ledger test, and the Predictions page shows how each has scored. Game dates are the NHL's (US Eastern); times are in your time zone.</p>`
        : "";
    root.innerHTML = `<div class="card upcoming-card">
        <div class="card-header fx-head"><h5>Next up</h5><span class="fx-head-meta">${shown ? `${shown} ${shown === 1 ? "game" : "games"}` : ""}${fixtureSource(payload.source)}</span></div>
        <div class="card-body">${body}${toggle}${more}${note}</div>
    </div>`;
    const button = root.querySelector(".fx-toggle");
    if (button) {
        button.addEventListener("click", () => {
            const opening = button.getAttribute("aria-expanded") !== "true";
            root.querySelectorAll(".fx-later").forEach((el) => {
                el.hidden = !opening;
            });
            button.setAttribute("aria-expanded", String(opening));
            button.textContent = opening ? "Show fewer games" : `Show ${hiddenGames} more ${hiddenGames === 1 ? "game" : "games"} on the next ${hidden.length === 1 ? "day" : `${hidden.length} days`}`;
        });
    }
    root.querySelectorAll(".fx-row").forEach((row) => {
        const open = () => openMatch(row.getAttribute("data-game-id"));
        row.addEventListener("click", open);
        row.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                open();
            }
        });
    });
    root.querySelectorAll("[data-section]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            showSection(el.getAttribute("data-section"));
        });
    });
}

function renderHome() {
    const c0 = meta.c0 || {};
    document.getElementById("home-kpis").innerHTML = [
        kpiHtml("C0 Brier", fmt(c0.brier, 4), `${c0.n?.toLocaleString() || "—"} eval games`),
        kpiHtml("ECE", fmt(c0.ece, 4), "probability points"),
        kpiHtml("K_MAX", String(meta.k_max ?? 10), `${(meta.registered_challengers || []).length} spent · ${(meta.k_max ?? 10) - (meta.registered_challengers || []).length} remain`),
        kpiHtml("Catalogue", seasonLabel(meta.catalogue_season), `${meta.n_games?.toLocaleString() || ""} games`),
    ].join("");
    renderHomeNotes(c0);
    renderCoverage();
    renderUpcoming();
    const cards = [
        ["Season", "This year at a glance", "Match counts, xG against goals, OT share, latest scores.", "dashboard"],
        ["Scores", "One day, every game", isStaticMode() ? "Results beside the Elo and Dixon–Coles win chances." : "Results beside the close, Elo and Dixon–Coles win chances.", "scores"],
        ["Standings", "The table on any date", "Division, wild card, conference and league views back to 2008-09.", "standings"],
        ["Games", "Every result", isStaticMode() ? "Search and filter, then open the model chances." : "Search and filter, then open the vig-free close.", "matches"],
        ["Teams", "One side, game by game", "Record, results strip, goals and 5v5 xG.", "teams"],
        ["Structure", "The league tree", "Each year's real conferences and divisions.", "structure"],
        ["Players", "Goalie GSAx", "Season board from MoneyPuck ice time.", "players"],
        ["Compare", "Process vs results", "5v5 goals against expected goals.", "comparison"],
        ["Years", "Cut by season", "Lockout, 3-on-3, Vegas, COVID, Seattle labelled.", "years"],
        ["Predictions", isStaticMode() ? "Scored against the close" : "The close, on the record", "Reliability, Brier split, Elo, Dixon–Coles, the probe.", "predictions"],
    ];
    document.getElementById("home-explore").innerHTML = cards
        .map(
            ([label, title, metaText, section]) =>
                `<div class="col-md-6 col-lg-4"><a class="explore-card" href="#${section}" data-section="${section}">
                <span class="kpi-label">${label}</span><strong>${title}</strong>
                <span class="explore-meta">${metaText}</span></a></div>`
        )
        .join("");
    document.querySelectorAll("#home-explore [data-section]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            showSection(el.getAttribute("data-section"));
        });
    });
}

async function renderSeason() {
    const select = document.getElementById("season-select");
    const selected = Number(select.value || defaultSeason());
    fillSeasonSelect(select, meta.seasons, selected);
    const payload = await fetchJSON(`/api/season/${selected}`);
    document.getElementById("season-eyebrow").textContent = seasonLabel(payload.season);
    document.getElementById("season-lede").textContent = `${eraTitle(payload.era)}. ${payload.finished} finished games.${Number(payload.season) === Number(meta.catalogue_season) && payload.scheduled === 0 && payload.finished < 1000 ? " The season is under way." : ""}`;
    document.getElementById("season-coverage").textContent =
        Number(payload.season) >= Math.min(...meta.eval_seasons) && Number(payload.season) <= Math.max(...meta.eval_seasons)
            ? "This year is inside the C0 eval window."
            : `This year is in the MoneyPuck file. The modelled close stops after ${seasonLabel(Math.max(...meta.eval_seasons))}.`;
    document.getElementById("season-kpis").innerHTML = [
        kpiHtml("Finished", String(payload.finished), `${payload.scheduled} scheduled`),
        kpiHtml("Goals / game", fmt(payload.mean_total, 2), "combined"),
        kpiHtml("OT/SO share", pct(payload.ot_share, 1), payload.flags?.ot_3v3 ? "3-on-3 OT era" : "4-on-4 then SO"),
        kpiHtml("ENG games", String(payload.eng_games), "empty-net goal scored"),
    ].join("");
    const xg = payload.xg_scatter || [];
    Plotly.react(
        "season-xg-chart",
        [
            {
                x: xg.map((p) => p.xg),
                y: xg.map((p) => p.goals),
                mode: "markers",
                marker: { color: "#2f6b4f", size: 7, opacity: 0.45 },
                text: xg.map((p) => p.team),
                hovertemplate: "%{text}<br>xG %{x:.2f}<br>goals %{y}<extra></extra>",
            },
        ],
        {
            ...PLOT_LAYOUT,
            xaxis: { title: "5v5 xG" },
            yaxis: { title: "5v5 goals" },
            shapes: xg.length
                ? [
                      {
                          type: "line",
                          x0: 0,
                          x1: Math.max(...xg.map((p) => p.xg), 1),
                          y0: 0,
                          y1: Math.max(...xg.map((p) => p.xg), 1),
                          line: { color: "#c4a35a", dash: "dash" },
                      },
                  ]
                : [],
        },
        { displayModeBar: false, responsive: true }
    );
    Plotly.react(
        "season-ot-chart",
        [
            {
                values: [payload.ot_share || 0, 1 - (payload.ot_share || 0)],
                labels: ["Went to OT/SO", "Regulation"],
                type: "pie",
                marker: { colors: ["#c4a35a", "#10233a"] },
                hole: 0.55,
                textinfo: "label+percent",
            },
        ],
        { ...PLOT_LAYOUT, showlegend: false, margin: { t: 10, b: 10, l: 10, r: 10 } },
        { displayModeBar: false, responsive: true }
    );
    const latestRoot = document.getElementById("season-latest");
    latestRoot.innerHTML = gamesTable(payload.latest || []);
    bindMatchRows(latestRoot);
}

async function renderMatches() {
    const seasonSelect = document.getElementById("matches-season");
    if (!seasonSelect.dataset.filled) {
        fillSeasonSelect(seasonSelect, meta.seasons, defaultSeason(), "All seasons");
        seasonSelect.dataset.filled = "1";
    }
    const params = new URLSearchParams({
        page: String(matchesPage),
        per_page: "25",
    });
    const q = document.getElementById("search-input").value;
    const status = document.getElementById("status-filter").value;
    const season = document.getElementById("matches-season").value;
    const gameType = document.getElementById("game-type-filter").value;
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (season) params.set("season", season);
    if (gameType) params.set("game_type", gameType);
    const payload = await fetchJSON(`/api/games?${params.toString()}`);
    const table = document.getElementById("matches-table");
    table.innerHTML = gamesTable(payload.data || []);
    bindMatchRows(table);
    const pg = payload.pagination;
    const nav = document.getElementById("matches-pagination");
    nav.innerHTML = `<ul class="pagination justify-content-end mb-0">
        <li class="page-item ${pg.page <= 1 ? "disabled" : ""}"><a class="page-link" href="#" data-page="${pg.page - 1}">Prev</a></li>
        <li class="page-item disabled"><span class="page-link">${pg.page} / ${pg.pages} · ${pg.total.toLocaleString()}</span></li>
        <li class="page-item ${pg.page >= pg.pages ? "disabled" : ""}"><a class="page-link" href="#" data-page="${pg.page + 1}">Next</a></li>
    </ul>`;
    nav.querySelectorAll("a.page-link").forEach((link) => {
        link.addEventListener("click", (ev) => {
            ev.preventDefault();
            matchesPage = Number(link.getAttribute("data-page"));
            renderMatches();
        });
    });
}

function teamTiles(teams) {
    const byDiv = {};
    teams.forEach((team) => {
        const key = team.conference ? `${team.conference} · ${team.division}` : `${team.division} (2020-21 temporary division)`;
        (byDiv[key] ||= []).push(team);
    });
    return Object.entries(byDiv)
        .map(([label, rows]) => {
            const cards = rows
                .map(
                    (team) => `<div class="col-md-3 mb-3"><a class="team-tile" href="#teams/${esc(team.abbr)}" data-team="${esc(team.abbr)}">
                    <strong>${esc(team.name)}</strong>
                    <span class="record">${esc(team.record)}</span>
                    <span class="explore-meta">${team.points} pts · GF ${fmt(team.goals_for, 0)} · xG ${fmt(team.xg_for, 1)}</span>
                </a></div>`
                )
                .join("");
            return `<div class="division-block"><h3>${esc(label)}</h3><div class="row">${cards}</div></div>`;
        })
        .join("");
}

async function renderTeamsIndex() {
    document.getElementById("teams-index").style.display = "";
    document.getElementById("team-dashboard").style.display = "none";
    const select = document.getElementById("teams-season");
    fillSeasonSelect(select, meta.seasons, select.value || defaultSeason());
    const payload = await fetchJSON(`/api/teams?season=${select.value}`);
    const grid = document.getElementById("teams-grid");
    grid.innerHTML = teamTiles(payload.teams || []);
    grid.querySelectorAll("[data-team]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            showSection("teams", { team: el.getAttribute("data-team") });
        });
    });
}

// One chip per game: green win, red regulation loss, amber overtime or shootout loss.
// A gold ring marks a win that needed extra time.
function resultChip(game) {
    const extra = game.decided_in === "OT" || game.decided_in === "SO" ? game.decided_in : "";
    let scored = Number(game.scored);
    let allowed = Number(game.allowed);
    if (game.decided_in === "SO") {
        if (game.team_result === "W") scored += 1;
        else allowed += 1;
    }
    let cls = "win";
    let letter = "W";
    if (game.team_result === "L") {
        cls = extra ? "otl" : "loss";
        letter = extra ? "OT" : "L";
    } else if (extra) {
        cls += " extra";
    }
    const tip = `${game.game_date} · ${game.is_home ? "vs" : "@"} ${game.opponent} · ${game.team_result} ${scored}–${allowed}${extra ? ` (${extra})` : ""}`;
    return `<button type="button" class="result-chip ${cls}" data-game-id="${esc(game.game_id)}" title="${esc(tip)}" aria-label="${esc(tip)}">${letter}</button>`;
}

function resultsStrip(games) {
    const reg = games.filter((g) => g.team_result && g.game_type === "REG");
    const post = games.filter((g) => g.team_result && g.game_type === "PLA");
    if (!reg.length && !post.length) return "";
    const block = (label, rows) =>
        rows.length ? `<div class="results-block"><span class="results-label">${label}</span><div class="results-chips">${rows.map(resultChip).join("")}</div></div>` : "";
    return `<div class="card mb-4"><div class="card-header"><h5>Results</h5></div><div class="card-body">
        ${block("Regular season", reg)}${block("Playoffs", post)}
        <p class="coverage-note mt-3 mb-0"><span class="result-chip win legend-chip">W</span> win <span class="result-chip loss legend-chip">L</span> regulation loss <span class="result-chip otl legend-chip">OT</span> overtime or shootout loss <span class="result-chip win extra legend-chip">W</span> won in extra time. Click a chip to open the game.</p>
    </div></div>`;
}

async function renderTeam(abbr) {
    const season = document.getElementById("teams-season").value || defaultSeason();
    const payload = await fetchJSON(`/api/teams/${encodeURIComponent(abbr)}?season=${season}`);
    document.getElementById("teams-index").style.display = "none";
    const dash = document.getElementById("team-dashboard");
    dash.style.display = "";
    const games = payload.games || [];
    const st = payload.standing;
    const placeText = payload.division
        ? `${st ? `${ordinal(st.division_rank)} in the ` : ""}${payload.division} Division${payload.conference ? "" : " (2020-21)"}${st?.slot ? ` · ${st.slot}` : ""}`
        : "";
    const standingTiles = st
        ? `<div class="row g-3 mb-4">
            ${kpiHtml("Division", st.division_rank ? ordinal(st.division_rank) : "—", esc(payload.division || ""))}
            ${kpiHtml("Last 10", esc(st.l10 || "—"), "W-L-OTL")}
            ${kpiHtml("Streak", esc(st.streak || "—"), "OT = overtime or shootout loss")}
            ${kpiHtml("Regulation wins", String(st.rw ?? "—"), `ROW ${st.row ?? "—"}`)}
        </div>`
        : "";
    dash.innerHTML = `
        <header class="page-hero">
            <p class="eyebrow"><button class="table-link" id="team-back" type="button">All teams</button></p>
            <h1>${esc(payload.name)}</h1>
            <p class="lede">${seasonLabel(payload.season)} · ${esc(payload.record)} · ${payload.points} pts${placeText ? ` · ${esc(placeText)}` : ""}</p>
        </header>
        <div class="row g-3 mb-4">
            ${kpiHtml("Record", esc(payload.record), "W-L-OTL, regular season")}
            ${kpiHtml("Points", String(payload.points), `${fmt(payload.points_pct, 3)} P% · ${payload.finished} GP`)}
            ${kpiHtml("GF", fmt(payload.goals_for, 0), `GA ${fmt(payload.goals_against, 0)} · 5v5 xGF ${fmt(payload.xg_for, 1)}`)}
            ${kpiHtml("Playoffs", esc(payload.playoff_record || "—"), payload.playoff_games ? `${payload.playoff_games} games` : "did not play")}
        </div>
        ${standingTiles}
        ${resultsStrip(games)}
        <div class="card"><div class="card-body">${gamesTable(games)}</div></div>`;
    dash.querySelector("#team-back").addEventListener("click", () => showSection("teams"));
    dash.querySelectorAll(".result-chip[data-game-id]").forEach((chip) => {
        chip.addEventListener("click", () => openMatch(chip.getAttribute("data-game-id")));
    });
    bindMatchRows(dash);
}

async function renderStructure() {
    const select = document.getElementById("structure-season");
    fillSeasonSelect(select, meta.seasons, select.value || defaultSeason());
    const payload = await fetchJSON(`/api/teams?season=${select.value}`);
    const conferences = {};
    (payload.teams || []).forEach((team) => {
        const conf = team.conference ? `${team.conference} Conference` : "Temporary divisions";
        const div = team.division || "";
        conferences[conf] ||= {};
        conferences[conf][div] ||= [];
        conferences[conf][div].push(team);
    });
    const confHtml = Object.entries(conferences)
        .map(([conf, divisions]) => {
            const slug = conf.toLowerCase().startsWith("east") ? "east" : conf.toLowerCase().startsWith("west") ? "west" : "league";
            const divHtml = Object.entries(divisions)
                .map(([div, teams]) => {
                    const tiles = teams
                        .map(
                            (team) =>
                                `<a class="tree-team" href="#teams/${esc(team.abbr)}" data-team="${esc(team.abbr)}"><span class="tree-team-name">${esc(team.name)}</span><span class="tree-team-record">${esc(team.record)}</span></a>`
                        )
                        .join("");
                    return `<div class="tree-division"><div class="tree-node tree-div">${esc(div)}</div><div class="tree-teams">${tiles}</div></div>`;
                })
                .join("");
            return `<div class="tree-conference tree-conference-${slug}"><div class="tree-node tree-conf">${esc(conf)}</div><div class="tree-divisions">${divHtml}</div></div>`;
        })
        .join("");
    document.getElementById("structure-tree").innerHTML = `<div class="tree-node tree-root">NHL</div><div class="tree-conferences">${confHtml}</div>`;
    document.querySelectorAll("#structure-tree [data-team]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            fillSeasonSelect(document.getElementById("teams-season"), meta.seasons, select.value);
            showSection("teams", { team: el.getAttribute("data-team") });
        });
    });
}

async function renderPlayers() {
    const select = document.getElementById("player-season");
    fillSeasonSelect(select, meta.seasons, select.value || defaultSeason());
    const params = new URLSearchParams({ season: select.value });
    const q = document.getElementById("player-search").value;
    const team = document.getElementById("player-team").value;
    if (q) params.set("q", q);
    if (team) params.set("team", team);
    const payload = await fetchJSON(`/api/players?${params.toString()}`);
    document.getElementById("players-coverage").textContent = payload.note || "";
    const teamSelect = document.getElementById("player-team");
    const current = teamSelect.value;
    teamSelect.innerHTML =
        `<option value="">All teams</option>` +
        (payload.teams || []).map((abbr) => `<option value="${esc(abbr)}">${esc(abbr)}</option>`).join("");
    teamSelect.value = current;
    const rows = payload.data || [];
    document.getElementById("players-table").innerHTML = `
        <table class="table"><thead><tr><th>Goalie</th><th>Team</th><th>GP</th><th>TOI (min)</th><th>xG against</th><th>GA</th><th>GSAx</th></tr></thead>
        <tbody>${rows
            .map(
                (row) =>
                    `<tr><td>${esc(row.name)}</td><td>${esc(row.team)}</td><td>${row.gp}</td><td>${fmt(row.ice_time, 0)}</td><td>${fmt(row.x_goals, 1)}</td><td>${fmt(row.goals, 1)}</td><td class="${row.gsax >= 0 ? "residual-pos" : "residual-neg"}">${fmt(row.gsax, 2)}</td></tr>`
            )
            .join("")}</tbody></table>`;
}

async function renderCompare() {
    const select = document.getElementById("compare-season");
    fillSeasonSelect(select, meta.seasons, select.value || defaultSeason());
    const payload = await fetchJSON(`/api/compare?season=${select.value}`);
    const teams = payload.teams || [];
    Plotly.react(
        "compare-chart",
        [
            {
                x: teams.map((t) => t.xg),
                y: teams.map((t) => t.goals),
                text: teams.map((t) => t.abbr),
                mode: "markers+text",
                textposition: "top center",
                marker: { color: "#10233a", size: 10 },
                hovertemplate: "%{text}<br>xG %{x:.1f}<br>goals %{y:.0f}<extra></extra>",
            },
        ],
        {
            ...PLOT_LAYOUT,
            xaxis: { title: "5v5 xG for" },
            yaxis: { title: "5v5 goals for" },
        },
        { displayModeBar: false, responsive: true }
    );
    document.getElementById("compare-table").innerHTML = `
        <table class="table"><thead><tr><th>Team</th><th>GP</th><th>Goals</th><th>xG</th><th>G − xG</th></tr></thead>
        <tbody>${teams
            .slice()
            .sort((a, b) => b.diff - a.diff)
            .map(
                (t) =>
                    `<tr><td>${esc(t.name)}</td><td>${t.n}</td><td>${fmt(t.goals, 0)}</td><td>${fmt(t.xg, 1)}</td><td class="${t.diff >= 0 ? "residual-pos" : "residual-neg"}">${fmt(t.diff, 1)}</td></tr>`
            )
            .join("")}</tbody></table>`;
}

async function renderYears() {
    const years = await fetchJSON("/api/years");
    document.getElementById("years-grid").innerHTML = years
        .map(
            (year) => `<div class="col-md-4 col-lg-3">
            <a class="explore-card" href="#dashboard" data-year="${esc(year.season)}">
                <span class="kpi-label">${esc(eraTitle(year.era))}</span>
                <strong>${seasonLabel(year.season)}</strong>
                <span class="explore-meta">${year.finished} games · ${year.playoff} playoff</span>
            </a></div>`
        )
        .join("");
    document.querySelectorAll("#years-grid [data-year]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            fillSeasonSelect(document.getElementById("season-select"), meta.seasons, el.getAttribute("data-year"));
            showSection("dashboard");
        });
    });
}

function confusionCell(conf, pred, actual) {
    return Number(conf?.[pred]?.[actual] ?? 0);
}

function renderAccuracyBoard(payload) {
    const board = payload.accuracy_board || {};
    const note = document.getElementById("pred-accuracy-note");
    if (note && board.note) note.textContent = board.note;
    const table = document.getElementById("pred-accuracy-table");
    const topId = board.top?.id;
    if (table) {
        table.innerHTML = `<table class="table pred-accuracy-table"><thead><tr>
            <th></th><th>Method</th><th>n</th><th>Accuracy</th><th>Role</th>
        </tr></thead><tbody>${(board.rows || [])
            .map(
                (row, i) => `<tr class="${row.id === topId ? "pred-leader" : ""}">
                <td>${i + 1}</td>
                <td>${esc(row.label)}</td>
                <td>${row.n?.toLocaleString() || "—"}</td>
                <td>${pct(row.accuracy, 1)}</td>
                <td>${esc(row.role)}</td>
            </tr>`
            )
            .join("")}</tbody></table>`;
    }
    const top = board.top || {};
    const title = document.getElementById("pred-confusion-title");
    if (title && top.label) title.textContent = `Confusion matrix · ${top.label}`;
    const lede = document.getElementById("pred-confusion-lede");
    if (lede && top.accuracy != null) {
        lede.textContent = `${top.label} picks the winner ${pct(top.accuracy, 1)} of the time on ${(top.n || 0).toLocaleString()} games. Rows are the pick; columns are the result.`;
    }
    const confRoot = document.getElementById("pred-confusion-table");
    if (!confRoot) return;
    const conf = top.confusion;
    if (!conf) {
        confRoot.innerHTML = "<p class='coverage-note mb-0'>No confusion matrix stored for this method.</p>";
        return;
    }
    const aa = confusionCell(conf, "away", "away");
    const ah = confusionCell(conf, "away", "home");
    const ha = confusionCell(conf, "home", "away");
    const hh = confusionCell(conf, "home", "home");
    const predAway = aa + ah;
    const predHome = ha + hh;
    const actAway = aa + ha;
    const actHome = ah + hh;
    const total = predAway + predHome;
    confRoot.innerHTML = `<table class="table pred-confusion">
        <thead>
            <tr><th></th><th colspan="2" class="axis-label">Actual</th><th></th></tr>
            <tr><th class="axis-label">Predicted</th><th>Away</th><th>Home</th><th>Total</th></tr>
        </thead>
        <tbody>
            <tr><th>Away</th><td class="diag">${aa.toLocaleString()}</td><td>${ah.toLocaleString()}</td><td>${predAway.toLocaleString()}</td></tr>
            <tr><th>Home</th><td>${ha.toLocaleString()}</td><td class="diag">${hh.toLocaleString()}</td><td>${predHome.toLocaleString()}</td></tr>
            <tr><th>Total</th><td>${actAway.toLocaleString()}</td><td>${actHome.toLocaleString()}</td><td>${total.toLocaleString()}</td></tr>
        </tbody>
    </table>`;
}

function signedPct(value, digits = 1) {
    if (value === null || value === undefined) return "—";
    const n = Number(value) * 100;
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

function renderYardstick(payload) {
    const c0 = payload.c0 || {};
    const seasons = payload.eval_seasons || [];
    const rows = payload.yardstick?.rows || [];
    const closeYard = rows.find((row) => row.id === "c0_market");
    const lede = document.getElementById("pred-why-lede");
    if (lede) {
        const platt = c0.platt_brier != null ? `Walk-forward Platt scores ${fmt(c0.platt_brier, 4)}, so recalibrating bought nothing. ` : "";
        const bar = closeYard
            ? `Calling the same home-win rate (${pct(closeYard.base_rate, 1)}) every game scores ${fmt(closeYard.base_brier, 4)}; the close scores ${fmt(c0.brier, 4)}, a ${signedPct(closeYard.skill)} improvement. `
            : "";
        lede.textContent = `The market is already calibrated. ${platt}${bar}Beating the close needs information it does not already have.`;
    }
    const table = document.getElementById("pred-yardstick-table");
    if (table) {
        table.innerHTML = rows.length
            ? `<table class="table"><thead><tr><th>Method</th><th>n</th><th>Brier</th><th title="Brier of calling one constant home-win rate for every game in the same set">Base-rate Brier</th><th title="1 − Brier ÷ base-rate Brier">Skill</th></tr></thead>
               <tbody>${rows
                   .map(
                       (row) =>
                           `<tr><td>${esc(row.label)}</td><td>${row.n?.toLocaleString() || "—"}</td><td>${fmt(row.brier, 4)}</td><td>${fmt(row.base_brier, 4)}</td><td class="${row.skill >= 0 ? "pred-better" : "pred-worse"}">${signedPct(row.skill)}</td></tr>`
                   )
                   .join("")}</tbody></table>
               <p class="coverage-note mt-2 mb-0">${esc(payload.yardstick.note)}</p>`
            : "";
    }
    const evalNote = document.getElementById("pred-eval-note");
    if (evalNote) {
        evalNote.textContent = `Eval seasons ${seasons.length ? `${seasons[0]}–${seasons[seasons.length - 1]}` : "—"}. n = ${c0.n?.toLocaleString() || "—"}. Daily game-day blocks. Shin locked before the walk.`;
    }
    const claim = document.getElementById("pred-brier-claim");
    if (claim) {
        claim.textContent = `Calibration ${fmt(c0.murphy_calibration, 4)}. Refinement ${fmt(c0.murphy_refinement, 4)}. ECE ${fmt(c0.ece, 4)}. The close is not losing on a squash.`;
    }
    const title = document.getElementById("pred-seasons-title");
    if (title && seasons.length) title.textContent = `Per season · ${seasons[0]}–${seasons[seasons.length - 1]}`;
}

function renderPredictions(payload) {
    const c0 = payload.c0 || {};
    const closeYard = (payload.yardstick?.rows || []).find((row) => row.id === "c0_market");
    document.getElementById("pred-summary").innerHTML = [
        kpiHtml("Brier", fmt(c0.brier, 4), `n = ${c0.n?.toLocaleString()}`, "col-6 col-md-4 col-lg"),
        kpiHtml("Log loss", fmt(c0.log_loss, 4), `acc ${pct(c0.accuracy, 1)}`, "col-6 col-md-4 col-lg"),
        kpiHtml("Elo Brier", fmt(payload.elo?.brier, 4), payload.elo?.registered ? "registered" : "lab, not a slot", "col-6 col-md-4 col-lg"),
        kpiHtml("DC Brier", fmt(payload.dc?.brier, 4), payload.dc?.registered ? "registered" : "lab, not a slot", "col-6 col-md-6 col-lg"),
        kpiHtml(
            "Constant rate",
            fmt(closeYard?.base_brier, 4),
            closeYard ? `same home-win rate every game · close skill ${signedPct(closeYard.skill)}` : "yardstick",
            "col-6 col-md-6 col-lg"
        ),
    ].join("");
    renderAccuracyBoard(payload);
    renderYardstick(payload);
    const bins = c0.reliability_bins || [];
    Plotly.react(
        "pred-reliability-chart",
        [
            {
                x: bins.map((b) => b.confidence),
                y: bins.map((b) => b.observed),
                mode: "markers+lines",
                marker: { color: "#10233a", size: 10 },
                line: { color: "#2f6b4f" },
                text: bins.map((b) => `n=${b.n}`),
                hovertemplate: "stated %{x:.2f}<br>observed %{y:.2f}<br>%{text}<extra></extra>",
            },
        ],
        {
            ...PLOT_LAYOUT,
            xaxis: { title: "Stated P(home)", range: [0.2, 0.9] },
            yaxis: { title: "Observed home-win rate", range: [0.2, 0.9] },
            shapes: [
                {
                    type: "line",
                    x0: 0.2,
                    x1: 0.9,
                    y0: 0.2,
                    y1: 0.9,
                    line: { color: "#c4a35a", dash: "dash" },
                },
            ],
        },
        { displayModeBar: false, responsive: true }
    );
    document.getElementById("pred-brier-table").innerHTML = `
        <table class="table"><tbody>
            <tr><th>Brier</th><td>${fmt(c0.brier, 4)}</td></tr>
            <tr><th>Calibration</th><td>${fmt(c0.murphy_calibration, 4)}</td></tr>
            <tr><th>Refinement</th><td>${fmt(c0.murphy_refinement, 4)}</td></tr>
            <tr><th>ECE</th><td>${fmt(c0.ece, 4)}</td></tr>
            <tr><th>Platt Brier</th><td>${fmt(c0.platt_brier, 4)}</td></tr>
        </tbody></table>`;
    const seasons = c0.per_season || [];
    document.getElementById("pred-seasons-table").innerHTML = `
        <table class="table"><thead><tr><th>Season</th><th>n</th><th>Brier</th><th>Log loss</th><th>Accuracy</th></tr></thead>
        <tbody>${seasons
            .map(
                (row) =>
                    `<tr><td>${seasonLabel(row.season)}</td><td>${row.n}</td><td>${fmt(row.brier, 4)}</td><td>${fmt(row.log_loss, 4)}</td><td>${pct(row.accuracy, 1)}</td></tr>`
            )
            .join("")}</tbody></table>`;
    const probes = payload.probe?.probes || [];
    document.getElementById("pred-probe-table").innerHTML = `
        <table class="table"><thead><tr><th>Feature</th><th>Target</th><th>n</th><th>Slope</th><th>p</th><th>Stable</th><th>Moves</th></tr></thead>
        <tbody>${probes
            .map(
                (row) =>
                    `<tr class="${row.moves_residual ? "pred-probe-clears" : ""}"><td>${esc(row.name)}</td><td>${esc(row.target)}</td><td>${row.n}</td><td>${fmt(row.slope, 4)}</td><td>${fmt(row.p, 4)}</td><td>${row.sign_stable ? "yes" : "no"}</td><td>${row.moves_residual ? "yes" : "no"}</td></tr>`
            )
            .join("")}</tbody></table>`;
    const dc = payload.dc || {};
    const dcEl = document.getElementById("pred-dc-lede");
    if (dcEl && dc.brier != null) {
        const vsClose = dc.brier_diff == null ? "—" : `${dc.brier_diff > 0 ? "+" : ""}${fmt(dc.brier_diff, 4)} vs C0`;
        dcEl.textContent = `Dixon–Coles Brier ${fmt(dc.brier, 4)} on ${dc.n?.toLocaleString() || "—"} C0 games with a prior-season fit (${vsClose}). Frozen GSAx-off was ${fmt(dc.frozen?.brier, 4)}. Previous-game starter GSAx scale ${fmt(dc.gsax_scale, 1)}. 2008 has no prediction. ${dc.beats_reference ? "Beats the close." : "Does not beat the close."} Not registered.`;
    }
    const dcTable = document.getElementById("pred-dc-table");
    if (dcTable) {
        dcTable.innerHTML = `<table class="table"><tbody>
            <tr><th>n</th><td>${dc.n?.toLocaleString() || "—"}</td></tr>
            <tr><th>GSAx Brier</th><td>${fmt(dc.brier, 4)}</td></tr>
            <tr><th>Frozen Brier</th><td>${fmt(dc.frozen?.brier, 4)}</td></tr>
            <tr><th>C0 Brier</th><td>${fmt(dc.c0_brier, 4)}</td></tr>
            <tr><th>Brier vs C0</th><td>${fmt(dc.brier_diff, 4)}</td></tr>
            <tr><th>GSAx scale</th><td>${dc.gsax_scale ?? "—"}</td></tr>
            <tr><th>Starter</th><td>${dc.starter_source || "previous_game"}</td></tr>
            <tr><th>Registered</th><td>${dc.registered ? "yes" : "no"}</td></tr>
        </tbody></table>`;
    }
    const elo = payload.elo || {};
    const eloEl = document.getElementById("pred-elo-lede");
    if (eloEl && elo.brier != null) {
        const vsClose = elo.brier_diff == null ? "—" : `${elo.brier_diff > 0 ? "+" : ""}${fmt(elo.brier_diff, 4)} vs C0`;
        const sel = elo.selected || elo.constants || {};
        eloEl.textContent = `Walk-forward Elo Brier ${fmt(elo.brier, 4)} on ${elo.n?.toLocaleString() || "—"} C0 games (${vsClose}). Live pick K = ${sel.k ?? "—"}, α = ${fmt(sel.alpha, 2)}, home ice ${sel.home_ice ?? "—"} pts. Frozen 538 was ${fmt(elo.frozen?.brier, 4)}. ${elo.beats_reference ? "Beats the close." : "Does not beat the close."} Not registered.`;
    }
    const eloTable = document.getElementById("pred-elo-table");
    if (eloTable) {
        const sel = elo.selected || {};
        eloTable.innerHTML = `<table class="table"><tbody>
            <tr><th>n</th><td>${elo.n?.toLocaleString() || "—"}</td></tr>
            <tr><th>Tuned Brier</th><td>${fmt(elo.brier, 4)}</td></tr>
            <tr><th>Frozen Brier</th><td>${fmt(elo.frozen?.brier, 4)}</td></tr>
            <tr><th>C0 Brier</th><td>${fmt(elo.c0_brier, 4)}</td></tr>
            <tr><th>Brier vs C0</th><td>${fmt(elo.brier_diff, 4)}</td></tr>
            <tr><th>Live K</th><td>${sel.k ?? "—"}</td></tr>
            <tr><th>Live α</th><td>${fmt(sel.alpha, 3)}</td></tr>
            <tr><th>Home ice</th><td>${sel.home_ice == null ? "—" : `${sel.home_ice} pts`}</td></tr>
            <tr><th>Registered</th><td>${elo.registered ? "yes" : "no"}</td></tr>
        </tbody></table>`;
    }
    const eloFits = document.getElementById("pred-elo-fits");
    if (eloFits && (elo.fits || []).length) {
        eloFits.innerHTML = `<table class="table"><thead><tr><th>Season</th><th>K</th><th>α</th><th>Home ice</th><th>Prior Brier</th></tr></thead>
        <tbody>${(elo.fits || [])
            .map(
                (row) =>
                    `<tr><td>${seasonLabel(row.season)}</td><td>${row.k ?? "—"}</td><td>${fmt(row.alpha, 2)}</td><td>${row.home_ice ?? "—"}</td><td>${fmt(row.prior_brier, 4)}</td></tr>`
            )
            .join("")}</tbody></table>`;
    }
    renderMlCard(payload.ml || {});
    const slot = payload.slot_1 || {};
    const slotClears = slot.clears_spending ? "cleared" : "did not clear";
    const slotEl = document.getElementById("pred-slot1-lede");
    if (slotEl && slot.ou_hit != null) {
        slotEl.textContent = `O/U hit ${pct(slot.ou_hit, 2)} on ${slot.ou_hit_n?.toLocaleString() || "—"} bets. Spent-α interval ${slot.ou_hit_ci_spent ? slot.ou_hit_ci_spent.map((x) => fmt(x, 4)).join("–") : "—"}. The totals gate ${slotClears}. Remaining α ${fmt(slot.remaining_after, 4)}.`;
    }
    const slotTable = document.getElementById("pred-slot1-table");
    if (slotTable) {
        slotTable.innerHTML = `<table class="table"><tbody>
            <tr><th>k</th><td>${slot.k ?? "1"}</td></tr>
            <tr><th>n</th><td>${slot.n?.toLocaleString() || "—"}</td></tr>
            <tr><th>O/U hit</th><td>${slot.ou_hit == null ? "—" : pct(slot.ou_hit, 2)}</td></tr>
            <tr><th>Spent-α CI</th><td>${slot.ou_hit_ci_spent ? slot.ou_hit_ci_spent.map((x) => fmt(x, 4)).join(" – ") : "—"}</td></tr>
            <tr><th>Total MAE vs C0</th><td>${fmt(slot.total_mae_diff, 4)}</td></tr>
            <tr><th>MAE non-inferior</th><td>${slot.total_mae_noninferior == null ? "—" : slot.total_mae_noninferior ? "yes" : "no"}</td></tr>
            <tr><th>Remaining α</th><td>${fmt(slot.remaining_after, 4)}</td></tr>
            <tr><th>Clears</th><td>${slot.clears_spending ? "yes" : "no"}</td></tr>
        </tbody></table>`;
    }
    const latestRoot = document.getElementById("pred-latest-games");
    latestRoot.innerHTML = gamesTable(payload.latest || []);
    bindMatchRows(latestRoot);
}

// ---------------------------------------------------------------- Scores

let scoresState = { date: null, prev: null, next: null, latest: null };

function probRow(label, p, row, title) {
    if (p === null || p === undefined) {
        return `<div class="prob-row prob-empty"><span class="prob-label" title="${esc(title)}">${label}</span><span class="prob-bar"></span><span class="prob-val">—</span><span class="prob-mark"></span></div>`;
    }
    let mark = `<span class="prob-mark"></span>`;
    if (row.status === "Finished" && row.home_win !== null && row.home_win !== undefined && Math.abs(p - 0.5) > 1e-9) {
        const right = p > 0.5 === (row.home_win === 1);
        mark = `<span class="prob-mark ${right ? "hit" : "miss"}" title="${right ? "Favoured the winner" : "Favoured the loser"}">${right ? "✓" : "✗"}</span>`;
    }
    return `<div class="prob-row"><span class="prob-label" title="${esc(title)}">${label}</span><span class="prob-bar" title="P(home win) ${pct(p, 1)}"><i style="width:${(p * 100).toFixed(1)}%"></i></span><span class="prob-val">${pct(p, 0)}</span>${mark}</div>`;
}

function scoreCard(game) {
    const done = game.status === "Finished";
    const goals = done ? finalGoals(game) : { away: "", home: "" };
    const state = done ? (game.decided_in === "OT" ? "Final / OT" : game.decided_in === "SO" ? "Final / SO" : "Final") : game.start_time ? startLabel(game.start_time) : "Scheduled";
    const kind = game.game_type === "PLA" ? "Playoffs" : "Regular season";
    const side = (abbr, name, record, value, won) =>
        `<div class="score-team${won ? " is-winner" : ""}"><span class="score-team-name"><strong>${esc(abbr)}</strong><span class="d-none d-sm-inline"> ${esc(name)}</span>${record ? `<em>${esc(record)}</em>` : ""}</span><span class="score-goals">${value}</span></div>`;
    const foot = [];
    if (game.away_xg_5v5 != null && game.home_xg_5v5 != null) foot.push(`5v5 xG ${fmt(game.away_xg_5v5, 2)} – ${fmt(game.home_xg_5v5, 2)}`);
    if (!isStaticMode() && game.total_line != null) foot.push(`Posted total ${esc(game.total_line)}`);
    const closeRow = isStaticMode() ? "" : probRow("Close", game.p_home, game, "Closing line, vig removed");
    return `<div class="col-md-6 col-xl-4"><div class="score-card" role="button" tabindex="0" data-game-id="${esc(game.game_id)}">
        <div class="score-card-head"><span class="score-state">${state}</span><span>${kind}</span></div>
        ${side(game.away_abbr, game.away_name, game.away_record, goals.away, done && game.home_win === 0)}
        ${side(game.home_abbr, game.home_name, game.home_record, goals.home, done && game.home_win === 1)}
        <div class="score-probs"><span class="score-probs-title">Home win chance</span>
            ${closeRow}
            ${probRow("Elo", game.p_elo, game, "Elo with home ice")}
            ${probRow("DC", game.p_dc, game, "Dixon–Coles")}
            ${probRow("ML", game.p_ml, game, "Logistic regression")}
        </div>
        ${foot.length ? `<div class="score-foot">${foot.join(" · ")}</div>` : ""}
    </div></div>`;
}

function dayChip(day) {
    const [y, m, d] = day.date.split("-").map(Number);
    const when = new Date(Date.UTC(y, m - 1, d));
    const dow = when.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const month = when.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    return `<button type="button" class="date-chip${day.selected ? " is-selected" : ""}${day.n ? " has-games" : ""}" data-date="${esc(day.date)}" aria-label="${esc(prettyDate(day.date))}, ${day.n} games" ${day.selected ? 'aria-current="date"' : ""}>
        <span class="dc-dow">${dow}</span><span class="dc-day">${d}</span><span class="dc-month">${month}</span><span class="dc-n">${day.n ? `${day.n} ${day.n === 1 ? "game" : "games"}` : "off"}</span></button>`;
}

async function renderScores(date) {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const payload = await fetchJSON(`/api/scoreboard${query}`);
    scoresState = { date: payload.date, prev: payload.prev_date, next: payload.next_date, latest: payload.latest_date };
    if (payload.date && location.hash !== `#scores/${payload.date}`) history.replaceState(null, "", `#scores/${payload.date}`);
    const input = document.getElementById("scores-date");
    input.value = payload.date || "";
    document.getElementById("scores-prev").disabled = !payload.prev_date;
    document.getElementById("scores-next").disabled = !payload.next_date;
    document.getElementById("scores-strip").innerHTML = (payload.strip || []).map(dayChip).join("");
    document.querySelectorAll("#scores-strip [data-date]").forEach((el) => {
        el.addEventListener("click", () => renderScores(el.getAttribute("data-date")));
    });
    const games = payload.games || [];
    const grid = document.getElementById("scores-grid");
    const summary = document.getElementById("scores-summary");
    if (!games.length) {
        grid.innerHTML = "";
        summary.textContent = payload.date ? `No games on ${prettyDate(payload.date)}. Use the arrows to reach the nearest game day.` : "No games in the catalogue.";
    } else {
        grid.innerHTML = games.map(scoreCard).join("");
        const called = payload.called || {};
        const bits = [
            ["Close", called.market],
            ["Elo", called.elo],
            ["Dixon–Coles", called.dc],
            ["Logistic", called.ml],
        ]
            .filter(([, v]) => v && v.of)
            .map(([label, v]) => `${label} ${v.right} of ${v.of}`);
        summary.textContent = `${prettyDate(payload.date)} · ${games.length} ${games.length === 1 ? "game" : "games"}${payload.finished !== games.length ? `, ${payload.finished} final` : ""}${bits.length ? ` · Favoured the winner: ${bits.join(" · ")}` : ""}`;
        grid.querySelectorAll(".score-card").forEach((card) => {
            const open = () => openMatch(card.getAttribute("data-game-id"));
            card.addEventListener("click", open);
            card.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    open();
                }
            });
        });
    }
    const first = games[0];
    const note = document.getElementById("scores-note");
    const hasClose = games.some((g) => g.p_home != null);
    note.textContent =
        games.length && !hasClose && !isStaticMode()
            ? "No closing line is held for this date, so only Elo and Dixon–Coles are shown. Records are W-L-OTL going into the game."
            : first
              ? "Records are W-L-OTL going into the game. A ✓ or ✗ shows whether that model's favourite won."
              : "";
}

// ------------------------------------------------------------- Standings

let standingsView = null;
let standingsAsOf = null;

const STANDINGS_COLUMNS = [
    { key: "gp", label: "GP", title: "Games played", w: 3 },
    { key: "w", label: "W", title: "Wins, including overtime and shootout wins", w: 2.8 },
    { key: "l", label: "L", title: "Regulation losses", w: 2.8 },
    { key: "otl", label: "OTL", title: "Overtime and shootout losses, worth one point", w: 2.8 },
    { key: "pts", label: "PTS", title: "Points: two per win, one per overtime or shootout loss", strong: true, w: 3.2 },
    { key: "pts_pct", label: "P%", cls: "st-pct", title: "Points percentage", format: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(3).replace(/^0/, "")), w: 3.6 },
    { key: "rw", label: "RW", title: "Regulation wins", w: 3, cls: "d-none d-lg-table-cell" },
    { key: "row", label: "ROW", title: "Regulation plus overtime wins, shootout wins excluded", w: 3, cls: "d-none d-lg-table-cell" },
    { key: "gf", label: "GF", title: "Goals for (a shootout winner gets one extra goal)", w: 3.2, cls: "d-none d-lg-table-cell" },
    { key: "ga", label: "GA", title: "Goals against (a shootout loser concedes one extra goal)", w: 3.2, cls: "d-none d-lg-table-cell" },
    { key: "diff", label: "DIFF", title: "Goal difference", signed: true, w: 3.4, cls: "d-none d-lg-table-cell" },
    { key: "home", label: "HOME", title: "Home record, W-L-OTL", w: 4.8, cls: "d-none d-xl-table-cell" },
    { key: "away", label: "AWAY", title: "Away record, W-L-OTL", w: 4.8, cls: "d-none d-xl-table-cell" },
    { key: "so", label: "S/O", title: "Shootout record, wins-losses", w: 3.4, cls: "d-none d-xl-table-cell" },
    { key: "l10", label: "L10", title: "Last ten games, W-L-OTL", w: 4, cls: "d-none d-xl-table-cell" },
    { key: "streak", label: "STRK", title: "Current streak (OT is an overtime or shootout loss)", w: 3.2, cls: "d-none d-xl-table-cell" },
];

function standingsCell(col, row) {
    const raw = row[col.key];
    let text = col.format ? col.format(raw) : raw === null || raw === undefined ? "—" : String(raw);
    let cls = col.cls || "";
    if (col.signed) {
        if (raw > 0) {
            text = `+${raw}`;
            cls += " residual-pos";
        } else if (raw < 0) {
            cls += " residual-neg";
        }
    }
    if (col.strong) cls += " st-strong";
    return `<td class="${cls.trim()}">${esc(text)}</td>`;
}

function standingsTable(section) {
    const head = STANDINGS_COLUMNS.map((c) => `<th class="${c.cls || ""}" style="--w:${c.w}rem" title="${esc(c.title)}">${c.label}</th>`).join("");
    const rows = section.rows
        .map((row) => {
            const classes = [row.qualified ? "st-in" : "", section.cut_after && row.rank === section.cut_after ? "st-cut" : ""].join(" ").trim();
            const badge = row.slot && !/^\d+$/.test(row.slot) ? `<span class="st-slot">${esc(row.slot)}</span>` : "";
            return `<tr class="${classes}"><td class="st-rank">${row.rank}</td>
                <td class="st-team"><a href="#teams/${esc(row.abbr)}" data-team="${esc(row.abbr)}"><span class="d-md-none">${esc(row.abbr)}</span><span class="d-none d-md-inline">${esc(row.name)}</span></a>${badge}</td>
                ${STANDINGS_COLUMNS.map((c) => standingsCell(c, row)).join("")}</tr>`;
        })
        .join("");
    return `<div class="st-section">${section.title ? `<h6 class="st-section-title">${esc(section.title)}</h6>` : ""}<div class="table-responsive st-wrap"><table class="table st-table"><thead><tr><th class="st-rank"></th><th class="st-team-head">Team</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function standingsNotes(p) {
    const notes = [];
    notes.push(p.format?.note);
    notes.push("Shaded rows are in a playoff position on the chosen date. Nothing is shown as clinched or eliminated.");
    notes.push(p.tiebreak_note);
    notes.push(
        "W includes overtime and shootout wins; L is regulation losses only; OTL is overtime or shootout losses. RW is regulation wins, ROW adds overtime wins. GF and GA give a shootout winner one extra goal, as the league's own tables do. S/O is shootout wins-losses, L10 is the last ten games, STRK the current run."
    );
    if (p.in_progress) {
        notes.push(`${seasonLabel(p.season)} is under way: ${p.games_counted} regular-season ${p.games_counted === 1 ? "game has" : "games have"} been played, so the order will move a lot.`);
    }
    if ((p.short_clubs || []).length) {
        const deficit = p.short_clubs.reduce((sum, c) => sum + (p.scheduled_games - c.gp), 0);
        const missing = Math.max(1, Math.round(deficit / 2));
        notes.push(`The source file is missing ${missing} game${missing === 1 ? "" : "s"} from this season, so ${p.short_clubs.map((c) => c.abbr).join(", ")} show${p.short_clubs.length === 1 ? "s" : ""} ${p.scheduled_games - 1} games instead of ${p.scheduled_games}.`);
    }
    return notes.filter(Boolean).map((text) => `<p class="coverage-note">${esc(text)}</p>`).join("");
}

async function renderStandings() {
    const select = document.getElementById("standings-season");
    if (!select.dataset.filled) {
        fillSeasonSelect(select, meta.seasons, defaultSeason());
        select.dataset.filled = "1";
    }
    const params = new URLSearchParams({ season: select.value });
    if (standingsView) params.set("view", standingsView);
    if (standingsAsOf) params.set("as_of", standingsAsOf);
    const p = await fetchJSON(`/api/standings?${params.toString()}`);
    standingsView = p.view;
    const date = document.getElementById("standings-asof");
    date.min = p.first_date || "";
    date.max = p.last_date || "";
    date.value = p.as_of || "";
    date.disabled = !p.first_date;
    document.getElementById("standings-views").innerHTML = (p.views || [])
        .map((v) => `<button type="button" class="btn btn-sm ${v.key === p.view ? "btn-primary" : "btn-outline-primary"}" data-view="${esc(v.key)}" aria-pressed="${v.key === p.view}">${esc(v.label)}</button>`)
        .join("");
    document.querySelectorAll("#standings-views [data-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
            standingsView = btn.getAttribute("data-view");
            renderStandings();
        });
    });
    const state = p.complete ? "final standings" : p.in_progress ? "season in progress" : "";
    document.getElementById("standings-asof-note").textContent = p.as_of
        ? `${seasonLabel(p.season)} · through ${prettyDate(p.as_of)} · ${p.games_counted.toLocaleString()} regular-season games${state ? ` · ${state}` : ""}`
        : `${seasonLabel(p.season)} · no games played yet`;
    document.getElementById("standings-tables").innerHTML = (p.groups || [])
        .map(
            (group) => `<div class="card mb-4"><div class="card-header"><h5>${esc(group.title)}</h5></div><div class="card-body st-body">
                ${group.sections
                    .map((section) => standingsTable(section))
                    .join("")}</div></div>`
        )
        .join("");
    document.getElementById("standings-notes").innerHTML = standingsNotes(p);
    document.querySelectorAll("#standings-tables [data-team]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            ev.preventDefault();
            fillSeasonSelect(document.getElementById("teams-season"), meta.seasons, select.value);
            showSection("teams", { team: el.getAttribute("data-team") });
        });
    });
}

function showSection(sectionName, extra) {
    document.querySelectorAll(".content-section").forEach((el) => {
        el.style.display = el.id === sectionName || (sectionName === "dashboard" && el.id === "dashboard") ? "" : "none";
    });
    if (sectionName === "home") document.getElementById("home").style.display = "";
    document.querySelectorAll(".nav-link").forEach((link) => {
        link.classList.toggle("active", link.getAttribute("data-section") === sectionName);
    });
    const hash = extra?.team ? `#teams/${extra.team}` : extra?.date ? `#scores/${extra.date}` : `#${sectionName}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    const loaders = {
        home: () => renderHome(),
        dashboard: () => renderSeason(),
        scores: () => renderScores(extra?.date || null),
        standings: () => renderStandings(),
        matches: () => renderMatches(),
        teams: () => (extra?.team ? renderTeam(extra.team) : renderTeamsIndex()),
        structure: () => renderStructure(),
        players: () => renderPlayers(),
        comparison: () => renderCompare(),
        years: () => renderYears(),
        predictions: () => renderPredictions(predictions),
    };
    const fn = loaders[sectionName];
    if (fn) fn();
}

function routeFromHash() {
    const raw = (location.hash || "#home").replace("#", "");
    if (raw.startsWith("teams/")) {
        showSection("teams", { team: raw.split("/")[1] });
        return;
    }
    if (raw.startsWith("scores/")) {
        showSection("scores", { date: raw.split("/")[1] });
        return;
    }
    const allowed = new Set(["home", "dashboard", "scores", "standings", "matches", "teams", "structure", "players", "comparison", "years", "predictions"]);
    showSection(allowed.has(raw) ? raw : "home");
}

async function boot() {
    meta = await fetchJSON("/api/meta");
    predictions = await fetchJSON("/api/predictions");
    document.querySelectorAll("[data-section]").forEach((el) => {
        el.addEventListener("click", (ev) => {
            if (el.tagName === "A" || el.tagName === "BUTTON") {
                const section = el.getAttribute("data-section");
                if (!section) return;
                ev.preventDefault();
                showSection(section);
            }
        });
    });
    document.getElementById("season-select").addEventListener("change", renderSeason);
    document.getElementById("matches-apply").addEventListener("click", () => {
        matchesPage = 1;
        renderMatches();
    });
    document.getElementById("teams-season").addEventListener("change", renderTeamsIndex);
    document.getElementById("structure-season").addEventListener("change", renderStructure);
    document.getElementById("players-apply").addEventListener("click", renderPlayers);
    document.getElementById("search-input").addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") document.getElementById("matches-apply").click();
    });
    document.getElementById("player-search").addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") renderPlayers();
    });
    document.getElementById("player-season").addEventListener("change", renderPlayers);
    document.getElementById("compare-apply").addEventListener("click", renderCompare);
    document.getElementById("compare-season").addEventListener("change", renderCompare);
    document.getElementById("scores-prev").addEventListener("click", () => scoresState.prev && renderScores(scoresState.prev));
    document.getElementById("scores-next").addEventListener("click", () => scoresState.next && renderScores(scoresState.next));
    document.getElementById("scores-latest").addEventListener("click", () => renderScores(null));
    document.getElementById("scores-date").addEventListener("change", (ev) => ev.target.value && renderScores(ev.target.value));
    document.getElementById("standings-season").addEventListener("change", () => {
        standingsAsOf = null;
        renderStandings();
    });
    document.getElementById("standings-asof").addEventListener("change", (ev) => {
        standingsAsOf = ev.target.value || null;
        renderStandings();
    });
    document.getElementById("standings-end").addEventListener("click", () => {
        standingsAsOf = null;
        renderStandings();
    });
    window.addEventListener("hashchange", routeFromHash);
    routeFromHash();
}

boot().catch((err) => {
    document.querySelector(".page-shell").insertAdjacentHTML(
        "afterbegin",
        `<div class="card mb-4"><div class="card-body"><p class="mb-0">Could not load the catalogue. ${esc(err.message)}. If this is a fresh clone, run <code>python -m scripts.ingest</code> first.</p></div></div>`
    );
});
