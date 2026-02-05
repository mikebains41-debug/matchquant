/* MatchQuant app.js — FULL REPLACEMENT (fixtures + xg + h2h loader + UI wiring)
   - Derives leagues/teams from JSON (no hard-coded lists)
   - Fixture dropdown works + auto-fills teams
   - Manual home/away still works
   - Calls window.runPrediction(params) from engine.js
*/

const $ = (id) => document.getElementById(id);

const els = {
  league: $("leagueSelect"),
  fixture: $("fixtureSelect"),
  home: $("homeSelect"),
  away: $("awaySelect"),
  sims: $("simsInput"),
  homeAdv: $("homeAdvInput"),
  baseGoals: $("baseGoalsInput"),
  capGoals: $("capGoalsInput"),
  leagueFactor: $("leagueFactorInput"),
  evThresh: $("evThreshInput"),
  runBtn: $("runBtn"),

  statusFixtures: $("statusFixtures"),
  statusXg: $("statusXg"),
  statusH2H: $("statusH2H"),
  readyLine: $("readyLine"),
  outCard: $("outCard"),
  fixturesTableBody: $("fixturesTableBody"),
};

let xgRaw = null;
let fixturesRaw = null;
let h2hRaw = null;

// normalized UI state
let leagues = [];
let teamsByLeague = new Map(); // league -> [team...]
let fixtures = []; // {id, league, home, away, date, odds?}

let currentLeague = "";
let currentFixtureId = "";
let currentHome = "";
let currentAway = "";

// ---------- helpers ----------
function setStatus(el, ok, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("bad", !ok);
}

function clearSelect(sel, placeholder) {
  if (!sel) return;
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  sel.appendChild(opt);
  sel.value = "";
}

function fillSelect(sel, items, placeholder) {
  clearSelect(sel, placeholder);
  for (const v of items) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

async function loadJson(path) {
  // cache-bust so GitHub Pages doesn’t serve stale JSON
  const url = `${path}?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.json();
}

// ---------- parsers (robust to different shapes) ----------
function parseXgTables(xg) {
  // Build league -> teams from xg_tables.json regardless of shape.
  const leagueTeams = new Map();

  if (!xg) return leagueTeams;

  const root = xg.leagues || xg.data || xg;

  // Shape A: array rows [{league, team, ...}, ...]
  if (Array.isArray(root)) {
    for (const row of root) {
      const league = row.league || row.competition || row.lg || row.League;
      const team = row.team || row.squad || row.Team || row.name;
      if (!league || !team) continue;
      if (!leagueTeams.has(league)) leagueTeams.set(league, []);
      leagueTeams.get(league).push(team);
    }
  }
  // Shape B: object map { "Premier League": { "Arsenal": {...}, ... }, ... }
  else if (root && typeof root === "object") {
    for (const league of Object.keys(root)) {
      const teamsObj = root[league];
      if (!teamsObj || typeof teamsObj !== "object") continue;

      // teamsObj could be array of teams, or map
      if (Array.isArray(teamsObj)) {
        for (const t of teamsObj) {
          const team =
            (typeof t === "string" && t) ||
            t.team ||
            t.squad ||
            t.Team ||
            t.name;
          if (!team) continue;
          if (!leagueTeams.has(league)) leagueTeams.set(league, []);
          leagueTeams.get(league).push(team);
        }
      } else {
        for (const team of Object.keys(teamsObj)) {
          if (!team) continue;
          if (!leagueTeams.has(league)) leagueTeams.set(league, []);
          leagueTeams.get(league).push(team);
        }
      }
    }
  }

  // de-dupe
  for (const [lg, arr] of leagueTeams.entries()) {
    leagueTeams.set(lg, uniqSorted(arr));
  }
  return leagueTeams;
}

function parseFixtures(fx) {
  // Normalize fixtures.json into array of:
  // { id, league, home, away, date, odds }
  const out = [];
  if (!fx) return out;

  const root = fx.fixtures || fx.matches || fx.data || fx;

  // Shape A: array
  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      const f = root[i] || {};
      const league = f.league || f.competition || f.lg || f.League;
      const home = f.home || f.homeTeam || f.Home || f.team1;
      const away = f.away || f.awayTeam || f.Away || f.team2;
      const date = f.date || f.kickoff || f.time || f.datetime || "";
      if (!league || !home || !away) continue;
      out.push({
        id: f.id || `${league}__${home}__${away}__${i}`,
        league,
        home,
        away,
        date,
        odds: f.odds || null,
      });
    }
  }
  // Shape B: object map
  else if (root && typeof root === "object") {
    let i = 0;
    for (const k of Object.keys(root)) {
      const f = root[k];
      if (!f || typeof f !== "object") continue;
      const league = f.league || f.competition || f.lg || f.League;
      const home = f.home || f.homeTeam || f.Home || f.team1;
      const away = f.away || f.awayTeam || f.Away || f.team2;
      const date = f.date || f.kickoff || f.time || f.datetime || "";
      if (!league || !home || !away) continue;
      out.push({
        id: f.id || k || `${league}__${home}__${away}__${i++}`,
        league,
        home,
        away,
        date,
        odds: f.odds || null,
      });
    }
  }

  return out;
}

// ---------- build UI data ----------
function rebuildDataModel() {
  // leagues = union of leagues from fixtures + xg
  const lgSet = new Set();

  // teamsByLeague union from fixtures + xg
  const map = new Map();

  // from fixtures
  for (const f of fixtures) {
    lgSet.add(f.league);
    if (!map.has(f.league)) map.set(f.league, []);
    map.get(f.league).push(f.home, f.away);
  }

  // from xg
  const xgMap = parseXgTables(xgRaw);
  for (const [lg, teams] of xgMap.entries()) {
    lgSet.add(lg);
    if (!map.has(lg)) map.set(lg, []);
    map.get(lg).push(...teams);
  }

  leagues = uniqSorted(Array.from(lgSet));

  for (const [lg, arr] of map.entries()) {
    map.set(lg, uniqSorted(arr));
  }
  teamsByLeague = map;
}

// ---------- UI builders ----------
function rebuildLeagueSelect() {
  fillSelect(els.league, leagues, "Select league");
}

function rebuildFixtureSelect(league) {
  const list = fixtures
    .filter((f) => !league || f.league === league)
    .map((f) => ({
      id: f.id,
      label: `${f.home} vs ${f.away}${f.date ? ` (${f.date})` : ""}`,
    }));

  clearSelect(els.fixture, "Select Fixture (optional)");
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    els.fixture.appendChild(opt);
  }
}

function rebuildTeamSelects(league) {
  const teams = teamsByLeague.get(league) || [];
  fillSelect(els.home, teams, "Select home");
  fillSelect(els.away, teams, "Select away");
}

function setReadyLine() {
  if (!els.readyLine) return;
  const ok = !!(currentLeague && currentHome && currentAway);
  els.readyLine.textContent = ok ? "✅ Ready" : "—";
}

// ---------- events ----------
function onLeagueChange() {
  currentLeague = els.league.value || "";
  currentFixtureId = "";
  if (els.fixture) els.fixture.value = "";

  // rebuild dependent selects
  rebuildFixtureSelect(currentLeague);
  rebuildTeamSelects(currentLeague);

  // clear selected teams
  currentHome = "";
  currentAway = "";
  if (els.home) els.home.value = "";
  if (els.away) els.away.value = "";

  setReadyLine();
}

function onFixtureChange() {
  const id = els.fixture.value || "";
  currentFixtureId = id;

  if (!id) {
    // just keep league selection; reset teams
    currentHome = "";
    currentAway = "";
    if (els.home) els.home.value = "";
    if (els.away) els.away.value = "";
    setReadyLine();
    return;
  }

  const f = fixtures.find((x) => x.id === id);
  if (!f) return;

  // set league to match fixture
  currentLeague = f.league;
  els.league.value = currentLeague;

  // rebuild lists for that league
  rebuildFixtureSelect(currentLeague);
  els.fixture.value = id;
  rebuildTeamSelects(currentLeague);

  // auto-fill teams
  currentHome = f.home;
  currentAway = f.away;
  els.home.value = currentHome;
  els.away.value = currentAway;

  setReadyLine();
}

function onHomeChange() {
  currentHome = els.home.value || "";
  setReadyLine();
}
function onAwayChange() {
  currentAway = els.away.value || "";
  setReadyLine();
}

// ---------- init ----------
async function init() {
  // initial status
  setStatus(els.statusFixtures, false, "fixtures loading…");
  setStatus(els.statusXg, false, "xg_tables loading…");
  setStatus(els.statusH2H, false, "h2h loading…");
  if (els.outCard) els.outCard.textContent = "";
  setReadyLine();

  try {
    // load all (h2h can fail without blocking)
    [fixturesRaw, xgRaw] = await Promise.all([
      loadJson("./fixtures.json"),
      loadJson("./xg_tables.json"),
    ]);

    try {
      h2hRaw = await loadJson("./h2h.json");
      setStatus(els.statusH2H, true, "h2h OK");
    } catch (e) {
      h2hRaw = null;
      setStatus(els.statusH2H, false, "h2h —");
      console.warn("h2h load failed:", e);
    }

    fixtures = parseFixtures(fixturesRaw);

    // Build model + UI
    rebuildDataModel();
    rebuildLeagueSelect();
    rebuildFixtureSelect(""); // all fixtures
    clearSelect(els.home, "Select home");
    clearSelect(els.away, "Select away");
    setReadyLine();

    setStatus(els.statusFixtures, true, `fixtures OK (${fixtures.length})`);
    setStatus(els.statusXg, true, `xg OK (${leagues.length} leagues)`);

    // Optional: preview fixtures table
    if (els.fixturesTableBody) {
      els.fixturesTableBody.innerHTML = "";
      const preview = fixtures.slice(0, 25);
      for (const f of preview) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${f.league}</td>
          <td>${f.home} vs ${f.away}</td>
          <td class="mono">${f.date || "—"}</td>
        `;
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
          els.fixture.value = f.id;
          onFixtureChange();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        els.fixturesTableBody.appendChild(tr);
      }
    }
  } catch (e) {
    console.error(e);
    setStatus(els.statusFixtures, false, "fixtures FAIL");
    setStatus(els.statusXg, false, "xg FAIL");
    alert("MatchQuant says\n\nPrediction error. Data failed to load.\n\nOpen Console for details.");
    return;
  }

  // wire events
  if (els.league) els.league.addEventListener("change", onLeagueChange);
  if (els.fixture) els.fixture.addEventListener("change", onFixtureChange);
  if (els.home) els.home.addEventListener("change", onHomeChange);
  if (els.away) els.away.addEventListener("change", onAwayChange);

  // run
  if (els.runBtn) {
    els.runBtn.addEventListener("click", () => {
      if (!currentLeague || !currentHome || !currentAway) {
        alert("MatchQuant says\n\nSelect league + home + away.");
        return;
      }
      if (currentHome === currentAway) {
        alert("MatchQuant says\n\nHome and Away cannot be the same team.");
        return;
      }

      // engine must exist
      if (typeof window.runPrediction !== "function") {
        console.warn("engine missing: window.runPrediction is not a function");
        alert("MatchQuant says\n\nEngine not found. Make sure engine.js is loaded correctly.");
        return;
      }

      const params = {
        league: currentLeague,
        home: currentHome,
        away: currentAway,
        sims: Number(els.sims?.value || 10000),
        homeAdv: Number(els.homeAdv?.value || 1.1),
        baseGoals: Number(els.baseGoals?.value || 1.35),
        capGoals: Number(els.capGoals?.value || 8),
        leagueFactorOverride: els.leagueFactor?.value ? Number(els.leagueFactor.value) : null,
        evThreshold: els.evThresh?.value ? Number(els.evThresh.value) : null,

        // give engine full data (optional use)
        xgRaw,
        fixtures,
        h2hRaw,
        fixtureId: currentFixtureId || null,
      };

      try {
        window.runPrediction(params);
      } catch (err) {
        console.error(err);
        alert("MatchQuant says\n\nPrediction error. Open DevTools Console for details.");
      }
    });
  }

  // helpful hint for Android users
  console.log("TIP: On Android, the <select> list is scrollable. Swipe inside the list to see all teams.");
}

document.addEventListener("DOMContentLoaded", init);
