/* MatchQuant app.js — DROP-IN (replaces your whole app.js)
   - Fixes Run Prediction not working (init runs + correct cap input id)
   - Robust loading of fixtures.json / xg_tables.json / h2h.json
   - Wires League / Fixture / Home / Away changes
   - Calls window.runPrediction(params) (engine.js must expose it)
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // --- ELEMENTS (must match index.html ids) ---
  const els = {
    league: $("leagueSelect"),
    fixture: $("fixtureSelect"),
    home: $("homeSelect"),
    away: $("awaySelect"),
    sims: $("simsInput"),
    homeAdv: $("homeAdvInput"),
    baseGoals: $("baseGoalsInput"),
    capGoals: $("maxGoalsCapInput"), // IMPORTANT: matches your index.html
    runBtn: $("runBtn"),
    statusLine: $("statusLine"),
    outCard: $("outputCard"),
    fixturesTable: $("fixturesTable"),
  };

  // --- STATE ---
  let xgRaw = null;
  let fixturesRaw = null;
  let h2hRaw = null;

  let leagues = [];
  let teamsByLeague = new Map(); // league -> [teams]
  let xgByLeagueTeam = new Map(); // league -> Map(team -> row/obj)
  let fixtures = []; // normalized fixtures

  let currentLeague = "";
  let currentFixtureId = "";
  let currentHome = "";
  let currentAway = "";

  // --- UI helpers ---
  function setStatus(text) {
    if (els.statusLine) els.statusLine.textContent = text || "";
  }

  function clearSelect(sel, placeholder) {
    if (!sel) return;
    sel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder || "Select";
    sel.appendChild(opt);
    sel.value = "";
  }

  function fillSelect(sel, items, placeholder) {
    clearSelect(sel, placeholder);
    if (!sel) return;
    for (const v of items || []) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
  }

  function uniqSorted(arr) {
    return Array.from(new Set(arr || [])).sort((a, b) => (a > b ? 1 : -1));
  }

  // --- Parse xg_tables.json into:
  // leagues[], teamsByLeague, xgByLeagueTeam
  function parseXgTables(xg) {
    leagues = [];
    teamsByLeague = new Map();
    xgByLeagueTeam = new Map();

    // Accept common shapes:
    // A) { "La Liga": { "Barcelona": {...}, ... }, ... }
    // B) { leagues: { "La Liga": {...} } } or { data: {...} }
    // C) array of rows: [{league:"La Liga", team:"Barcelona", ...}, ...]
    const root = (xg && (xg.leagues || xg.data || xg.tables || xg)) || {};

    if (Array.isArray(root)) {
      for (const row of root) {
        const league = row.league || row.competition || row.lg || "";
        const team = row.team || row.squad || row.name || "";
        if (!league || !team) continue;

        if (!xgByLeagueTeam.has(league)) xgByLeagueTeam.set(league, new Map());
        xgByLeagueTeam.get(league).set(team, row);

        if (!teamsByLeague.has(league)) teamsByLeague.set(league, []);
        teamsByLeague.get(league).push(team);
      }
    } else if (root && typeof root === "object") {
      for (const league of Object.keys(root)) {
        const teamsObj = root[league];
        if (!teamsObj || typeof teamsObj !== "object") continue;

        if (!xgByLeagueTeam.has(league)) xgByLeagueTeam.set(league, new Map());
        if (!teamsByLeague.has(league)) teamsByLeague.set(league, []);

        for (const team of Object.keys(teamsObj)) {
          xgByLeagueTeam.get(league).set(team, teamsObj[team]);
          teamsByLeague.get(league).push(team);
        }
      }
    }

    leagues = uniqSorted(Array.from(teamsByLeague.keys()));
    for (const lg of leagues) teamsByLeague.set(lg, uniqSorted(teamsByLeague.get(lg)));
  }

  // --- Normalize fixtures.json into array [{id, league, home, away, date, odds}] ---
  function parseFixtures(fx) {
    const out = [];
    const root = (fx && (fx.fixtures || fx.data || fx.matches || fx)) || [];

    if (Array.isArray(root)) {
      for (let i = 0; i < root.length; i++) {
        const f = root[i] || {};
        const league = f.league || f.competition || f.lg || "";
        const home = f.home || f.homeTeam || f.h || "";
        const away = f.away || f.awayTeam || f.a || "";
        const date = f.date || f.kickoff || f.time || "";
        if (!league || !home || !away) continue;
        out.push({
          id: f.id || `${league}__${home}__${away}__${date || i}`,
          league,
          home,
          away,
          date,
          odds: f.odds || null,
        });
      }
    } else if (root && typeof root === "object") {
      for (const k of Object.keys(root)) {
        const f = root[k] || {};
        const league = f.league || f.competition || f.lg || "";
        const home = f.home || f.homeTeam || f.h || "";
        const away = f.away || f.awayTeam || f.a || "";
        const date = f.date || f.kickoff || f.time || "";
        if (!league || !home || !away) continue;
        out.push({
          id: f.id || k || `${league}__${home}__${away}__${date || k}`,
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

  // --- UI builders ---
  function rebuildLeagueSelect() {
    fillSelect(els.league, leagues, "Select League");
  }

  function rebuildFixtureSelect(selectedLeague) {
    const list = fixtures
      .filter((f) => !selectedLeague || f.league === selectedLeague)
      .map((f) => ({ id: f.id, label: `${f.home} vs ${f.away}` }));

    clearSelect(els.fixture, "Select Fixture (optional)");
    if (!els.fixture) return;

    for (const item of list) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      els.fixture.appendChild(opt);
    }
  }

  function rebuildTeamSelects(selectedLeague) {
    const teams = teamsByLeague.get(selectedLeague) || [];
    fillSelect(els.home, teams, "Select Home Team");
    fillSelect(els.away, teams, "Select Away Team");
  }

  // --- Event handlers ---
  function onLeagueChange() {
    currentLeague = els.league?.value || "";
    currentFixtureId = "";
    if (els.fixture) els.fixture.value = "";
    currentHome = "";
    currentAway = "";

    rebuildFixtureSelect(currentLeague);
    rebuildTeamSelects(currentLeague);

    if (els.home) els.home.value = "";
    if (els.away) els.away.value = "";

    setStatus(currentLeague ? "League selected ✅" : "");
  }

  function onFixtureChange() {
    const id = els.fixture?.value || "";
    currentFixtureId = id;

    if (!id) {
      // user cleared fixture, keep league and let them choose teams
      currentHome = "";
      currentAway = "";
      if (els.home) els.home.value = "";
      if (els.away) els.away.value = "";
      setStatus(currentLeague ? "Pick teams or pick a fixture." : "");
      return;
    }

    const f = fixtures.find((x) => x.id === id);
    if (!f) return;

    // ensure league matches fixture league
    currentLeague = f.league;
    if (els.league) els.league.value = currentLeague;

    rebuildFixtureSelect(currentLeague);
    if (els.fixture) els.fixture.value = id;

    rebuildTeamSelects(currentLeague);

    currentHome = f.home;
    currentAway = f.away;
    if (els.home) els.home.value = currentHome;
    if (els.away) els.away.value = currentAway;

    setStatus("Fixture loaded ✅");
  }

  function onHomeChange() {
    currentHome = els.home?.value || "";
  }

  function onAwayChange() {
    currentAway = els.away?.value || "";
  }

  function runClicked() {
    // Basic validation
    if (!currentLeague) {
      alert("Select League first.");
      return;
    }
    if (!currentHome || !currentAway) {
      alert("Select Home Team and Away Team.");
      return;
    }
    if (currentHome === currentAway) {
      alert("Home and Away cannot be the same team.");
      return;
    }

    // Must have engine
    if (typeof window.runPrediction !== "function") {
      console.warn("window.runPrediction not found. engine.js must define it.");
      alert("Engine not found. Make sure engine.js loads and defines window.runPrediction.");
      return;
    }

    const sims = Number(els.sims?.value || 10000);
    const homeAdv = Number(els.homeAdv?.value || 1.1);
    const baseGoals = Number(els.baseGoals?.value || 1.35);
    const capGoals = Number(els.capGoals?.value || 8);

    const params = {
      league: currentLeague,
      home: currentHome,
      away: currentAway,
      sims,
      homeAdv,
      baseGoals,
      capGoals,
      xgRaw,
      fixtures,
      h2hRaw,
    };

    setStatus("Running…");
    try {
      window.runPrediction(params);
      setStatus("Done ✅");
    } catch (e) {
      console.error(e);
      setStatus("Error ❌");
      alert("Prediction error. Open DevTools Console for details.");
    }
  }

  // --- Data loading ---
  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  async function init() {
    setStatus("Loading data…");

    try {
      [fixturesRaw, xgRaw, h2hRaw] = await Promise.all([
        loadJson("./fixtures.json"),
        loadJson("./xg_tables.json"),
        loadJson("./h2h.json"),
      ]);

      fixtures = parseFixtures(fixturesRaw);
      parseXgTables(xgRaw);

      // Build UI
      rebuildLeagueSelect();
      rebuildFixtureSelect("");
      clearSelect(els.home, "Select Home Team");
      clearSelect(els.away, "Select Away Team");

      setStatus("Ready ✅");

      // Wire events
      if (els.league) els.league.addEventListener("change", onLeagueChange);
      if (els.fixture) els.fixture.addEventListener("change", onFixtureChange);
      if (els.home) els.home.addEventListener("change", onHomeChange);
      if (els.away) els.away.addEventListener("change", onAwayChange);
      if (els.runBtn) els.runBtn.addEventListener("click", runClicked);

    } catch (e) {
      console.error(e);
      setStatus("Load error ❌");
      alert("Data failed to load. Check file names and GitHub Pages cache.");
    }
  }

  // IMPORTANT: actually run init
  document.addEventListener("DOMContentLoaded", init);
})();
