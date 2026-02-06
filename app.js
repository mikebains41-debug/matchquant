/* MatchQuant app.js (Option B+) 
   - Teams auto-built from fixtures.json (no missing teams)
   - Alias mapping via data/aliases.json
   - League strength multipliers via data/league_strength.json
   - Optional Pro unlock gate (no server)
*/

let FIXTURES = {};
let ALIASES = {};
let LEAGUE_STRENGTH = {};
let XG_DATA = null;

// ---------- PRO UNLOCK (no-server gate) ----------
function isPro() {
  return localStorage.getItem("mq_pro") === "1";
}
function tryProUnlockFromQuery() {
  const url = new URL(window.location.href);
  const key = url.searchParams.get("prokey");
  // change this to any string you want
  const VALID = "MATCHQUANTPRO2026";
  if (key && key === VALID) {
    localStorage.setItem("mq_pro", "1");
    // remove key from URL after storing
    url.searchParams.delete("prokey");
    history.replaceState({}, "", url.toString());
  }
}

// ---------- LOADERS ----------
async function loadJson(path) {
  const res = await fetch(path + "?v=1");
  if (!res.ok) throw new Error("Failed to load: " + path);
  return await res.json();
}

async function safeLoadJson(path, fallback) {
  try {
    return await loadJson(path);
  } catch {
    return fallback;
  }
}

// ---------- ALIAS + NORMALIZE ----------
function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "")
    .replace(/\./g, "");
}

// returns canonical name for matching data sources
function canon(league, teamName) {
  const L = ALIASES[league] || {};
  const key = norm(teamName);
  return L[key] || teamName;
}

// build team list from fixtures.json
function teamsFromFixtures(league) {
  const rows = FIXTURES[league] || [];
  const set = new Set();
  rows.forEach((m) => {
    if (m.home) set.add(m.home);
    if (m.away) set.add(m.away);
    // also support alternate keys if your fixtures use different field names
    if (m.Home) set.add(m.Home);
    if (m.Away) set.add(m.Away);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function leaguesFromFixtures() {
  return Object.keys(FIXTURES).sort((a, b) => a.localeCompare(b));
}

function fillSelect(selectEl, items, placeholder) {
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  items.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

// ---------- UI ----------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    tryProUnlockFromQuery();

    // required
    FIXTURES = await loadJson("./fixtures.json");

    // optional files (safe)
    ALIASES = await safeLoadJson("./data/aliases.json", {});
    LEAGUE_STRENGTH = await safeLoadJson("./data/league_strength.json", {});
    XG_DATA = await safeLoadJson("./data/xg_2025_2026.json", null);

    const leagueSel = document.getElementById("league");
    const homeSel = document.getElementById("homeTeam");
    const awaySel = document.getElementById("awayTeam");
    const runBtn = document.getElementById("runBtn");
    const resultsEl = document.getElementById("results");

    const leagues = leaguesFromFixtures();
    fillSelect(leagueSel, leagues, "Choose league");

    leagueSel.addEventListener("change", () => {
      const league = leagueSel.value;
      const teams = teamsFromFixtures(league);
      fillSelect(homeSel, teams, "Home team");
      fillSelect(awaySel, teams, "Away team");
    });

    // default league
    if (leagues.length) {
      leagueSel.value = leagues[0];
      leagueSel.dispatchEvent(new Event("change"));
    }

    runBtn.addEventListener("click", () => {
      const league = leagueSel.value;
      const homeRaw = homeSel.value;
      const awayRaw = awaySel.value;

      if (!league || !homeRaw || !awayRaw || homeRaw === awayRaw) {
        resultsEl.innerHTML = "Select league, home team, and away team.";
        return;
      }

      const home = canon(league, homeRaw);
      const away = canon(league, awayRaw);

      const params = {
        league,
        home,
        away,
        homeRaw,
        awayRaw,
        sims: parseInt(document.getElementById("sims").value || "10000", 10),
        homeAdv: parseFloat(document.getElementById("homeAdv").value || "1.10"),
        baseGoals: parseFloat(document.getElementById("baseGoals").value || "1.35"),
        capGoals: 10,
        xgData: XG_DATA,
        fixtures: FIXTURES,
        leagueStrength: LEAGUE_STRENGTH,
        pro: isPro()
      };

      resultsEl.innerHTML = window.runPrediction(params);
    });

  } catch (err) {
    console.error(err);
    alert("MatchQuant failed to start. Check console/logs.");
  }
});
