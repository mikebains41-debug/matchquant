// MatchQuant - app.js (simple + stable)
// Loads: xg_tables.json, fixtures.json (optional), h2h.json (optional)
// Works on GitHub Pages

let XG = {};
let FIXTURES = [];
let H2H = [];

const LEAGUE_BASE = {
  "Premier League": { home: 1.45, away: 1.20, hfa: 1.08 },
  "La Liga":        { home: 1.35, away: 1.10, hfa: 1.07 },
  "Bundesliga":     { home: 1.60, away: 1.30, hfa: 1.06 },
  "Serie A":        { home: 1.35, away: 1.10, hfa: 1.07 },
  "Ligue 1":        { home: 1.40, away: 1.15, hfa: 1.07 },
};

function $(id) { return document.getElementById(id); }

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function safeNum(v, fallback = 1.0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function loadJSON(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn("loadJSON failed:", path, e);
    return fallback;
  }
}

function setStatus(id, ok, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? `✓ ${text}` : `✗ ${text}`;
  el.style.opacity = ok ? 1 : 0.65;
}

function clearSelect(sel, placeholder = "Select...") {
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  sel.appendChild(opt);
}

function fillSelect(sel, items) {
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    sel.appendChild(opt);
  }
}

function getLeagues() {
  return Object.keys(XG || {}).sort();
}

function getTeams(league) {
  if (!league || !XG[league]) return [];
  return Object.keys(XG[league]).sort((a, b) => a.localeCompare(b));
}

function getFixturesForLeague(league) {
  if (!Array.isArray(FIXTURES)) return [];
  return FIXTURES
    .filter(f => !league || f.league === league)
    .map(f => `${f.home} vs ${f.away} (${f.date || ""})`.trim());
}

function parseFixtureLabel(label) {
  // "Home vs Away (YYYY-MM-DD)"
  const m = label.match(/^(.*?)\s+vs\s+(.*?)\s+\((.*?)\)\s*$/);
  if (!m) return null;
  return { home: m[1].trim(), away: m[2].trim(), date: m[3].trim() };
}

function findFixtureByLabel(label) {
  const p = parseFixtureLabel(label);
  if (!p) return null;
  const f = FIXTURES.find(x =>
    x.home === p.home && x.away === p.away && String(x.date || "").trim() === p.date
  );
  return f || null;
}

function poissonSample(lambda) {
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function mostLikelyScoreFromMatrix(mat) {
  let best = { i: 0, j: 0, p: -1 };
  for (let i = 0; i < mat.length; i++) {
    for (let j = 0; j < mat[i].length; j++) {
      if (mat[i][j] > best.p) best = { i, j, p: mat[i][j] };
    }
  }
  return `${best.i}-${best.j}`;
}

function buildScoreMatrix(homeLambda, awayLambda, maxGoals = 6) {
  // quick approx by sampling many times (since we already do sims)
  // Here we return empty; we’ll fill using sims
  return Array.from({ length: maxGoals + 1 }, () => Array(maxGoals + 1).fill(0));
}

function computeLambdas(league, home, away) {
  const base = LEAGUE_BASE[league] || { home: 1.40, away: 1.15, hfa: 1.07 };

  const h = XG?.[league]?.[home] || {};
  const a = XG?.[league]?.[away] || {};

  // If user later swaps to real numbers, still works.
  const hatt = safeNum(h.att, 1.0);
  const hdef = safeNum(h.def, 1.0);
  const aatt = safeNum(a.att, 1.0);
  const adef = safeNum(a.def, 1.0);

  let homeLambda = base.home * base.hfa * hatt * adef;
  let awayLambda = base.away * aatt * hdef;

  homeLambda = clamp(homeLambda, 0.20, 3.50);
  awayLambda = clamp(awayLambda, 0.20, 3.50);

  return { homeLambda, awayLambda };
}

function formatPct(x) { return `${Math.round(x * 100)}%`; }

function runPrediction() {
  const league = $("league").value;
  const fixtureLabel = $("fixture").value;
  let home = $("home").value;
  let away = $("away").value;

  // If fixture selected, auto override teams
  if (fixtureLabel) {
    const fx = findFixtureByLabel(fixtureLabel);
    if (fx) { home = fx.home; away = fx.away; }
  }

  if (!league) { alert("Pick a league"); return; }
  if (!home || !away) { alert("Pick teams"); return; }
  if (home === away) { alert("Home and away can’t be the same"); return; }

  const sims = clamp(parseInt($("sims").value || "10000", 10), 1000, 200000);

  const { homeLambda, awayLambda } = computeLambdas(league, home, away);

  let homeW = 0, draw = 0, awayW = 0;
  let over25 = 0, btts = 0;

  let sumH = 0, sumA = 0;

  const maxG = 6;
  const mat = buildScoreMatrix(homeLambda, awayLambda, maxG);

  for (let i = 0; i < sims; i++) {
    const hg = poissonSample(homeLambda);
    const ag = poissonSample(awayLambda);

    sumH += hg; sumA += ag;

    const hgc = Math.min(hg, maxG);
    const agc = Math.min(ag, maxG);
    mat[hgc][agc] += 1;

    if (hg > ag) homeW++;
    else if (hg === ag) draw++;
    else awayW++;

    if (hg + ag >= 3) over25++;
    if (hg >= 1 && ag >= 1) btts++;
  }

  // normalize matrix
  for (let i = 0; i < mat.length; i++) {
    for (let j = 0; j < mat[i].length; j++) {
      mat[i][j] /= sims;
    }
  }

  const bestScore = mostLikelyScoreFromMatrix(mat);

  const out = `
<div class="mono">
  <div><b>${league}</b></div>
  <div><b>${home}</b> vs <b>${away}</b></div>
  <hr/>
  <div>λ Home: ${homeLambda.toFixed(2)} | λ Away: ${awayLambda.toFixed(2)}</div>
  <div>Avg goals: ${(sumH/sims).toFixed(2)} - ${(sumA/sims).toFixed(2)} (sims: ${sims})</div>
  <div>Most likely score: <b>${bestScore}</b></div>
  <hr/>
  <div>1X2: Home ${formatPct(homeW/sims)} | Draw ${formatPct(draw/sims)} | Away ${formatPct(awayW/sims)}</div>
  <div>O2.5: ${formatPct(over25/sims)} | BTTS: ${formatPct(btts/sims)}</div>
</div>`.trim();

  $("output").innerHTML = out;

  // H2H (optional)
  const h2hBox = $("h2h");
  if (h2hBox) {
    const found = (Array.isArray(H2H) ? H2H : []).find(x =>
      (x.home === home && x.away === away && x.league === league) ||
      (x.home === away && x.away === home && x.league === league)
    );

    if (!found) {
      h2hBox.textContent = "No H2H found for this matchup (in h2h.json).";
    } else {
      const hs = found.home_score ?? found.hs ?? "";
      const as = found.away_score ?? found.as ?? "";
      const score = (hs !== "" && as !== "") ? `${hs}-${as}` : "N/A";
      const cards = found.cards ?? "N/A";
      const corners = found.corners ?? "N/A";
      h2hBox.textContent = `${found.home} ${score} ${found.away} | Cards: ${cards} | Corners: ${corners}`;
    }
  }
}

function onLeagueChanged() {
  const league = $("league").value;

  // teams
  const teams = getTeams(league);
  clearSelect($("home"), "Select home team...");
  clearSelect($("away"), "Select away team...");
  fillSelect($("home"), teams);
  fillSelect($("away"), teams);

  // fixtures
  const labels = getFixturesForLeague(league);
  clearSelect($("fixture"), "Select a fixture...");
  fillSelect($("fixture"), labels);
}

function onFixtureChanged() {
  const label = $("fixture").value;
  if (!label) return;
  const fx = findFixtureByLabel(label);
  if (!fx) return;
  $("home").value = fx.home || "";
  $("away").value = fx.away || "";
}

async function init() {
  XG = await loadJSON("xg_tables.json", {});
  FIXTURES = await loadJSON("fixtures.json", []);
  H2H = await loadJSON("h2h.json", []);

  setStatus("xgStatus", !!Object.keys(XG).length, `xG loaded (${getLeagues().length} leagues)`);
  setStatus("fxStatus", Array.isArray(FIXTURES), `fixtures loaded (${Array.isArray(FIXTURES) ? FIXTURES.length : 0})`);
  setStatus("h2hStatus", Array.isArray(H2H), `H2H loaded (${Array.isArray(H2H) ? H2H.length : 0})`);

  // Fill leagues
  const leagues = getLeagues();
  clearSelect($("league"), "Select a league...");
  fillSelect($("league"), leagues);

  $("league").addEventListener("change", onLeagueChanged);
  $("fixture").addEventListener("change", onFixtureChanged);

  // Button
  window.runPrediction = runPrediction;
}

document.addEventListener("DOMContentLoaded", init);
