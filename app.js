// MatchQuant UI wiring (data-driven dropdowns)
// Works with teams.json + aliases.json + league_strength.json in /data

const $ = (id) => document.getElementById(id);

const leagueEl = $("league");
const homeEl = $("homeTeam");
const awayEl = $("awayTeam");
const runBtn = $("runBtn");
const resultsEl = $("results");
const statusEl = $("status");

let TEAMS = null;
let ALIASES = {};
let LEAGUE_STRENGTH = {};

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

// supports multiple possible shapes:
// A) { leagues: [{key,name,teams:[...]}] }
// B) { "Premier League": ["Arsenal", ...], "La Liga": [...] }
// C) [{league:"Premier League", teams:[...]}]
function normalizeTeamsJson(raw) {
  // Case A
  if (raw && Array.isArray(raw.leagues)) {
    return raw.leagues.map((l, idx) => ({
      key: l.key || l.name || String(idx),
      name: l.name || l.key || `League ${idx + 1}`,
      teams: Array.isArray(l.teams) ? l.teams : [],
    }));
  }

  // Case B (object map)
  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    return Object.keys(raw).map((leagueName) => ({
      key: leagueName,
      name: leagueName,
      teams: Array.isArray(raw[leagueName]) ? raw[leagueName] : [],
    }));
  }

  // Case C
  if (Array.isArray(raw)) {
    // maybe array of leagues or array of strings
    if (raw.length && typeof raw[0] === "string") {
      // unknown league; treat as one league
      return [{ key: "League", name: "League", teams: raw }];
    }
    return raw.map((l, idx) => ({
      key: l.key || l.name || l.league || String(idx),
      name: l.name || l.league || l.key || `League ${idx + 1}`,
      teams: Array.isArray(l.teams) ? l.teams : (Array.isArray(l.items) ? l.items : []),
    }));
  }

  // fallback
  return [];
}

function fillSelect(selectEl, options, placeholder) {
  selectEl.innerHTML = "";
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    selectEl.appendChild(opt);
  }
  for (const v of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

function getLeagueList() {
  return TEAMS || [];
}

function getTeamsForLeagueKey(leagueKey) {
  const leagues = getLeagueList();
  const found = leagues.find((l) => l.key === leagueKey || l.name === leagueKey);
  return found ? (found.teams || []) : [];
}

// optional alias mapping if engine expects a different spelling
function aliasTeam(name) {
  return ALIASES?.[name] || name;
}

function renderError(err) {
  resultsEl.textContent = `Error: ${err?.message || err}`;
}

async function boot() {
  try {
    setStatus("Loading data…");

    const [teamsRaw, aliasesRaw, strengthRaw] = await Promise.all([
      loadJSON("data/teams.json"),
      loadJSON("data/aliases.json").catch(() => ({})),
      loadJSON("data/league_strength.json").catch(() => ({})),
    ]);

    TEAMS = normalizeTeamsJson(teamsRaw);
    ALIASES = aliasesRaw || {};
    LEAGUE_STRENGTH = strengthRaw || {};

    // ✅ FIX: if TEAMS is empty, show a clear message
    if (!TEAMS.length) {
      setStatus("");
      resultsEl.textContent =
        "teams.json loaded but no leagues/teams were found. Open data/teams.json and make sure it contains league names + team lists.";
      // still populate league dropdown with nothing to prevent undefined numeric options
      fillSelect(leagueEl, [], "Choose league");
      fillSelect(homeEl, [], "Choose home");
      fillSelect(awayEl, [], "Choose away");
      return;
    }

    // populate league dropdown with league NAMES (not numbers)
    const leagueNames = TEAMS.map((l) => l.name);
    fillSelect(leagueEl, leagueNames, "Choose league");

    // default to first real league
    leagueEl.value = leagueNames[0];

    // load teams for selected league
    const teams = getTeamsForLeagueKey(leagueEl.value);
    fillSelect(homeEl, teams, "Choose home");
    fillSelect(awayEl, teams, "Choose away");

    // sensible defaults
    if (teams.length >= 2) {
      homeEl.value = teams[0];
      awayEl.value = teams[1];
    }

    // when league changes, update teams
    leagueEl.addEventListener("change", () => {
      const t = getTeamsForLeagueKey(leagueEl.value);
      fillSelect(homeEl, t, "Choose home");
      fillSelect(awayEl, t, "Choose away");
      if (t.length >= 2) {
        homeEl.value = t[0];
        awayEl.value = t[1];
      }
    });

    runBtn.addEventListener("click", runPrediction);

    setStatus("Ready.");
  } catch (e) {
    setStatus("");
    renderError(e);
  }
}

function runPrediction() {
  try {
    const leagueName = leagueEl.value;
    const homeTeam = homeEl.value;
    const awayTeam = awayEl.value;

    if (!leagueName || !homeTeam || !awayTeam) {
      resultsEl.textContent = "Pick league + both teams first.";
      return;
    }
    if (homeTeam === awayTeam) {
      resultsEl.textContent = "Home and Away cannot be the same team.";
      return;
    }

    const sims = Number($("sims")?.value || 10000);
    const homeAdv = Number($("homeAdv")?.value || 1.1);
    const baseGoals = Number($("baseGoals")?.value || 1.35);

    // Optional league multiplier
    const leagueMult =
      (LEAGUE_STRENGTH && (LEAGUE_STRENGTH[leagueName] ?? LEAGUE_STRENGTH[leagueName.toLowerCase()])) || 1.0;

    // ✅ IMPORTANT: send the names using keys engine expects
    const payload = {
      leagueName,
      homeTeam: aliasTeam(homeTeam),
      awayTeam: aliasTeam(awayTeam),
      sims,
      homeAdv,
      baseGoals,
      leagueMult,
    };

    // engine.js should provide a function. We support common names.
    const fn =
      window.runMatchQuant ||
      window.runPrediction ||
      window.predictMatch ||
      window.engineRun;

    if (typeof fn !== "function") {
      resultsEl.textContent =
        "engine.js did not expose a runner function. Make sure engine.js defines window.runMatchQuant = function(payload){...}";
      return;
    }

    const out = fn(payload);

    // ✅ FIX: render HTML properly if out is HTML
    if (typeof out === "string" && out.includes("<")) {
      resultsEl.innerHTML = out;
    } else if (typeof out === "string") {
      resultsEl.textContent = out;
    } else {
      resultsEl.textContent = JSON.stringify(out, null, 2);
    }
  } catch (e) {
    renderError(e);
  }
}

boot();
