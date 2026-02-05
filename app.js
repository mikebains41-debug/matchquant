/* MatchQuant app.js — FIXED UI WIRING (League → Teams/Fixtures) — Mode C
   - Leagues derived from xg_tables.json
   - Teams derived from xg_tables.json for selected league
   - If fixture selected, fixture auto-fills league/home/away
   - Robust to different JSON shapes (array or object maps)
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

// --- STATE ---
let xgRaw = null;
let fixturesRaw = null;
let h2hRaw = null;

let leagues = [];
let teamsByLeague = new Map();  // league -> [teamName]
let xgByLeagueTeam = new Map(); // league -> Map(team -> record)
let fixtures = [];              // normalized fixtures

let currentLeague = "";
let currentFixtureId = "";
let currentHome = "";
let currentAway = "";

// --- HELPERS ---
function setStatus(el, ok, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("bad", !ok);
}

function clearSelect(sel, placeholder = "Select...") {
  if (!sel) return;
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  sel.appendChild(opt);
  sel.value = "";
}

function fillSelect(sel, items, placeholder = "Select...") {
  clearSelect(sel, placeholder);
  for (const v of items) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

// Normalize xg_tables.json into:
// leagues[], teamsByLeague, xgByLeagueTeam
function parseXgTables(xg) {
  leagues = [];
  teamsByLeague = new Map();
  xgByLeagueTeam = new Map();

  // Accept 2 common shapes:
  // 1) { "Premier League": { "Arsenal": {att:..,def:..}, ... }, "La Liga": {...} }
  // 2) { leagues: { ... } } or { data: { ... } }
  // 3) array: [{league:"Premier League", team:"Arsenal", att:.., def:..}, ...]
  const root = (xg && (xg.leagues || xg.data)) ? (xg.leagues || xg.data) : xg;

  if (Array.isArray(root)) {
    for (const row of root) {
      const league = row.league || row.comp || row.competition;
      const team = row.team || row.squad || row.name;
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
  // de-dupe teams per league
  for (const lg of leagues) {
    teamsByLeague.set(lg, uniqSorted(teamsByLeague.get(lg) || []));
  }
}

// Normalize fixtures.json into array:
// { id, league, home, away, date, odds? }
function parseFixtures(fx) {
  const out = [];

  const root = (fx && (fx.fixtures || fx.data)) ? (fx.fixtures || fx.data) : fx;

  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      const f = root[i] || {};
      const league = f.league || f.comp || f.competition;
      const home = f.home || f.homeTeam || f.h;
      const away = f.away || f.awayTeam || f.a;
      const date = f.date || f.kickoff || f.time || "";
      if (!league || !home || !away) continue;
      out.push({
        id: f.id || `${league}__${home}__${away}__${date || i}`,
        league, home, away, date,
        odds: f.odds || null
      });
    }
  } else if (root && typeof root === "object") {
    // If it's a map, flatten
    let i = 0;
    for (const k of Object.keys(root)) {
      const f = root[k];
      const league = f.league || f.comp || f.competition;
      const home = f.home || f.homeTeam || f.h;
      const away = f.away || f.awayTeam || f.a;
      const date = f.date || f.kickoff || f.time || "";
      if (!league || !home || !away) continue;
      out.push({ id: f.id || k || `${league}__${home}__${away}__${date || i++}`, league, home, away, date, odds: f.odds || null });
    }
  }

  return out;
}

// --- UI BUILDERS ---
function rebuildLeagueSelect() {
  fillSelect(els.league, leagues, "Select League");
}

function rebuildFixtureSelect(league) {
  const list = fixtures
    .filter(f => !league || f.league === league)
    .map(f => `${f.league}__${f.home}__${f.away}${f.date ? `__${f.date}` : ""}`);

  // Use these strings as ids as well for simplicity
  clearSelect(els.fixture, "Select Fixture (optional)");
  for (const f of fixtures.filter(f => !league || f.league === league)) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.home} vs ${f.away}${f.date ? ` • ${f.date}` : ""}`;
    els.fixture.appendChild(opt);
  }
}

function rebuildTeamSelects(league) {
  const teams = teamsByLeague.get(league) || [];
  fillSelect(els.home, teams, "Select home team");
  fillSelect(els.away, teams, "Select away team");
}

function setReadyLine() {
  if (!els.readyLine) return;
  if (currentLeague && currentHome && currentAway) {
    els.readyLine.textContent = `✅ Ready: ${currentLeague} — ${currentHome} vs ${currentAway}`;
  } else {
    els.readyLine.textContent = `—`;
  }
}

// --- EVENT WIRING ---
function onLeagueChange() {
  currentLeague = els.league.value || "";
  currentFixtureId = "";

  // reset fixture selection
  if (els.fixture) els.fixture.value = "";

  // rebuild fixture list and teams for this league
  rebuildFixtureSelect(currentLeague);
  rebuildTeamSelects(currentLeague);

  // clear selected teams
  currentHome = "";
  currentAway = "";
  els.home.value = "";
  els.away.value = "";

  setReadyLine();
}

function onFixtureChange() {
  const id = els.fixture.value || "";
  currentFixtureId = id;

  if (!id) {
    // fixture cleared → keep league but allow manual team selection
    currentHome = "";
    currentAway = "";
    els.home.value = "";
    els.away.value = "";
    setReadyLine();
    return;
  }

  const f = fixtures.find(x => x.id === id);
  if (!f) return;

  // ensure league matches fixture league
  currentLeague = f.league;
  els.league.value = currentLeague;

  // rebuild dependent selects
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

// --- LOAD DATA ---
async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return await res.json();
}

async function init() {
  // Set loading status
  setStatus(els.statusFixtures, false, "fixtures.json (loading...)");
  setStatus(els.statusXg, false, "xg_tables.json (loading...)");
  setStatus(els.statusH2H, false, "h2h.json (loading...)");

  try {
    [fixturesRaw, xgRaw, h2hRaw] = await Promise.all([
      loadJson("./fixtures.json"),
      loadJson("./xg_tables.json"),
      loadJson("./h2h.json"),
    ]);

    fixtures = parseFixtures(fixturesRaw);
    parseXgTables(xgRaw);

    // Status OK
    setStatus(els.statusFixtures, true, `fixtures.json (${fixtures.length})`);
    // count teams
    let teamCount = 0;
    for (const lg of leagues) teamCount += (teamsByLeague.get(lg) || []).length;
    setStatus(els.statusXg, true, `xg_tables.json (${teamCount} teams)`);
    setStatus(els.statusH2H, true, `h2h.json (ok)`);

    // Build UI lists
    rebuildLeagueSelect();
    rebuildFixtureSelect(""); // all
    clearSelect(els.home, "Select home team");
    clearSelect(els.away, "Select away team");
    setReadyLine();

    // Populate fixtures table preview (optional)
    if (els.fixturesTableBody) {
      els.fixturesTableBody.innerHTML = "";
      for (let i = 0; i < Math.min(fixtures.length, 50); i++) {
        const f = fixtures[i];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${f.home} vs ${f.away}<div class="sub">${f.league} • ${f.date || ""}</div></td>
          <td class="mono">—</td>
          <td class="mono">—</td>
          <td class="mono">—</td>
          <td class="mono">—</td>
        `;
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
          // selecting a row = selecting fixture
          els.fixture.value = f.id;
          onFixtureChange();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        els.fixturesTableBody.appendChild(tr);
      }
    }

  } catch (e) {
    console.error(e);
    setStatus(els.statusFixtures, false, `fixtures.json (error)`);
    setStatus(els.statusXg, false, `xg_tables.json (error)`);
    setStatus(els.statusH2H, false, `h2h.json (error)`);
  }

  // Wire events (always)
  if (els.league) els.league.addEventListener("change", onLeagueChange);
  if (els.fixture) els.fixture.addEventListener("change", onFixtureChange);
  if (els.home) els.home.addEventListener("change", onHomeChange);
  if (els.away) els.away.addEventListener("change", onAwayChange);

  // Run button uses your existing engine.js simulate() function if present
  if (els.runBtn) {
    els.runBtn.addEventListener("click", () => {
      if (!currentLeague || !currentHome || !currentAway) {
        alert("Select league + home + away (or pick a fixture).");
        return;
      }

      // If your engine.js exposes window.runPrediction, use it.
      // Otherwise you’ll see console warning.
      if (typeof window.runPrediction === "function") {
        const params = {
          league: currentLeague,
          home: currentHome,
          away: currentAway,
          sims: Number(els.sims?.value || 10000),
          homeAdv: Number(els.homeAdv?.value || 1.10),
          baseGoals: Number(els.baseGoals?.value || 1.35),
          capGoals: Number(els.capGoals?.value || 8),
          leagueFactorOverride: (els.leagueFactor?.value || "").trim(),
          evThreshold: Number(els.evThresh?.value || 0.03),
          xgRaw,
          fixtures,
          h2hRaw,
        };
        window.runPrediction(params);
      } else {
        console.warn("engine.js must define window.runPrediction(params).");
        alert("Engine not found. Make sure engine.js is loaded and defines window.runPrediction().");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
