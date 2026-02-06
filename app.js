/* MatchQuant app.js (replacement)
   - Fixes league dropdown showing 0..8 by always building labeled options
   - Loads:
       /data/league_strength.json   (optional, helps order + labels)
       /data/teams.json             (required)
       /data/aliases.json           (optional)
   - Expects index.html to have:
       #league, #homeTeam, #awayTeam, #sims, #homeAdv, #baseGoals, #goalCap, #runSim, #result
*/

const $ = (id) => document.getElementById(id);

const UI = {
  league: $("league"),
  home: $("homeTeam"),
  away: $("awayTeam"),
  sims: $("sims"),
  homeAdv: $("homeAdv"),
  baseGoals: $("baseGoals"),
  goalCap: $("goalCap"),
  run: $("runSim"),
  result: $("result"),
};

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (!x) return [];
  if (typeof x === "object") return Object.values(x);
  return [];
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function safeText(s) {
  return String(s ?? "").trim();
}

function option(el, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  el.appendChild(opt);
}

function clearSelect(el, placeholder) {
  el.innerHTML = "";
  if (placeholder) option(el, "", placeholder);
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return await r.json();
}

/* ----- Data normalizers ----- */

// Normalize league_strength.json into: [{ key, label, strength }]
function normalizeLeagues(leagueStrengthRaw) {
  // Accept forms:
  // 1) { "Premier League": 1.2, "La Liga": 1.15, ... }
  // 2) [{ league:"Premier League", strength:1.2 }, ...]
  // 3) [{ key:"EPL", label:"Premier League", strength:1.2 }, ...]
  // 4) { leagues: [...] }
  const out = [];

  if (!leagueStrengthRaw) return out;

  const raw =
    Array.isArray(leagueStrengthRaw)
      ? leagueStrengthRaw
      : Array.isArray(leagueStrengthRaw.leagues)
      ? leagueStrengthRaw.leagues
      : leagueStrengthRaw;

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row) continue;
      const key = safeText(row.key || row.id || row.code || row.league || row.name);
      const label = safeText(row.label || row.name || row.league || key);
      const strength =
        Number(row.strength ?? row.value ?? row.rating ?? row.power ?? 1) || 1;
      if (key) out.push({ key, label, strength });
    }
    return out;
  }

  if (isObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const key = safeText(k);
      const label = safeText(k);
      const strength = Number(v) || 1;
      if (key) out.push({ key, label, strength });
    }
    return out;
  }

  return out;
}

// Normalize teams.json into: Map(leagueKey -> [teamName,...])
function normalizeTeams(teamsRaw, aliasesRaw) {
  // Accept forms:
  // A) { "Premier League": ["Arsenal","Chelsea"...], "La Liga": [...] }
  // B) { leagues: { "Premier League": [...] } }
  // C) [{ league:"Premier League", teams:[...] }, ...]
  // D) { "EPL": { teams:[...] } } or { "EPL": { "Arsenal": {...} } }
  const map = new Map();

  const aliases = isObject(aliasesRaw) ? aliasesRaw : {};

  function aliasName(name) {
    // if alias file maps "Man City" -> "Manchester City", etc.
    const n = safeText(name);
    return safeText(aliases[n] || n);
  }

  const raw =
    teamsRaw && teamsRaw.leagues ? teamsRaw.leagues : teamsRaw;

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row) continue;
      const leagueKey = safeText(row.key || row.id || row.code || row.league || row.name);
      const teamsArr =
        Array.isArray(row.teams) ? row.teams :
        Array.isArray(row.items) ? row.items :
        [];
      const teams = teamsArr.map(aliasName).filter(Boolean);
      if (leagueKey && teams.length) map.set(leagueKey, uniqueSorted(teams));
    }
    return map;
  }

  if (isObject(raw)) {
    for (const [leagueKeyRaw, v] of Object.entries(raw)) {
      const leagueKey = safeText(leagueKeyRaw);
      let teams = [];

      if (Array.isArray(v)) {
        teams = v.map(aliasName);
      } else if (isObject(v)) {
        if (Array.isArray(v.teams)) {
          teams = v.teams.map(aliasName);
        } else {
          // If object keys are team names
          teams = Object.keys(v).map(aliasName);
        }
      }

      teams = teams.filter(Boolean);
      if (leagueKey && teams.length) map.set(leagueKey, uniqueSorted(teams));
    }
    return map;
  }

  return map;
}

function uniqueSorted(arr) {
  return [...new Set(arr.map(safeText).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/* ----- App state ----- */
let leagues = [];          // [{key,label,strength}]
let teamsByLeague = new Map(); // key -> [team,...]

// If league_strength missing, show these labels (in this order if found)
const FALLBACK_LEAGUE_LABELS = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Primeira Liga",
  "Eredivisie",
  "Championship",
  "UEFA Champions League",
  "Europa League",
];

function buildLeagueListFromTeamsMap(map) {
  const keys = [...map.keys()];
  // Try to order by common league names first
  const ordered = [];
  for (const name of FALLBACK_LEAGUE_LABELS) {
    const hit = keys.find(k => k.toLowerCase() === name.toLowerCase());
    if (hit) ordered.push(hit);
  }
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  return ordered.map(k => ({ key: k, label: k, strength: 1 }));
}

/* ----- UI builders ----- */

function renderLeagues() {
  clearSelect(UI.league, "Choose league");

  // Sort by strength desc if available
  const list = [...leagues].sort((a, b) => (b.strength || 1) - (a.strength || 1));

  for (const l of list) {
    // CRITICAL: value is the key, label is text.
    // This prevents 0..8 showing up.
    option(UI.league, l.key, l.label);
  }

  // auto-select first real league
  if (list.length) {
    UI.league.value = list[0].key;
  }
}

function renderTeams() {
  const leagueKey = UI.league.value;
  const teams = teamsByLeague.get(leagueKey) || [];

  clearSelect(UI.home, "Home team");
  clearSelect(UI.away, "Away team");

  for (const t of teams) {
    option(UI.home, t, t);
    option(UI.away, t, t);
  }

  // default: first team home, second team away (if possible)
  if (teams.length >= 2) {
    UI.home.value = teams[0];
    UI.away.value = teams[1];
  }
}

function renderError(msg) {
  UI.result.innerHTML = `<div class="card" style="padding:12px;">
    <b>Error:</b> ${msg}
  </div>`;
}

/* ----- Run prediction ----- */

function runPrediction() {
  const leagueKey = UI.league.value;
  const home = UI.home.value;
  const away = UI.away.value;

  if (!leagueKey || !home || !away) {
    renderError("Pick league + teams first.");
    return;
  }
  if (home === away) {
    renderError("Home and Away teams must be different.");
    return;
  }

  const sims = Number(UI.sims?.value || 10000);
  const homeAdv = Number(UI.homeAdv?.value || 1.10);
  const baseGoals = Number(UI.baseGoals?.value || 1.35);
  const goalCap = Number(UI.goalCap?.value || 8);

  // engine.js should expose something like:
  // window.MatchQuantEngine.predict({ league, home, away, sims, homeAdv, baseGoals, goalCap })
  // OR a function predictMatch(...)
  try {
    let out = null;

    if (window.MatchQuantEngine?.predict) {
      out = window.MatchQuantEngine.predict({
        league: leagueKey,
        home,
        away,
        sims,
        homeAdv,
        baseGoals,
        goalCap,
      });
    } else if (typeof window.predictMatch === "function") {
      out = window.predictMatch(leagueKey, home, away, sims, homeAdv, baseGoals, goalCap);
    } else {
      renderError("engine.js not loaded or predict function not found.");
      return;
    }

    // Render whatever comes back
    UI.result.innerHTML = `
      <div class="card" style="padding:14px;">
        <div style="font-weight:700; font-size:1.05rem; margin-bottom:6px;">
          ${home} vs ${away}
        </div>
        <pre style="white-space:pre-wrap; margin:0;">${safeText(
          typeof out === "string" ? out : JSON.stringify(out, null, 2)
        )}</pre>
      </div>
    `;
  } catch (e) {
    renderError(e.message || String(e));
  }
}

/* ----- Boot ----- */
async function init() {
  try {
    UI.result.innerHTML = `<div class="card" style="padding:12px;">Loading data…</div>`;

    let aliases = null;
    try { aliases = await fetchJSON("data/aliases.json"); } catch (_) {}

    let leagueStrength = null;
    try { leagueStrength = await fetchJSON("data/league_strength.json"); } catch (_) {}

    const teamsRaw = await fetchJSON("data/teams.json");

    teamsByLeague = normalizeTeams(teamsRaw, aliases);

    leagues = normalizeLeagues(leagueStrength);

    // If league_strength missing or empty, build from teams keys
    if (!leagues.length) {
      leagues = buildLeagueListFromTeamsMap(teamsByLeague);
    }

    renderLeagues();
    renderTeams();

    UI.league.addEventListener("change", renderTeams);
    UI.run.addEventListener("click", runPrediction);

    UI.result.innerHTML = `<div class="card" style="padding:12px;">Ready ✅</div>`;
  } catch (e) {
    renderError(e.message || String(e));
  }
}

document.addEventListener("DOMContentLoaded", init);
