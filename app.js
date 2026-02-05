"use strict";

/** ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);

function cleanName(s) {
  return (s ?? "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function keyName(s) {
  // case-insensitive + remove punctuation for matching
  return cleanName(s)
    .toLowerCase()
    .replace(/[’'".,()/\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function setStatus(id, okText, failText, ok) {
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? okText : failText;
}

/** ---------- data stores ---------- */
let xgTables = {};     // { league: { teamName: {att, def} } }
let fixtures = [];     // [{league, home, away, date?}]
let h2hList = [];      // [{league?, home, away, score, corners, cards, date?}]

/** ---------- xG normalization ---------- */
/**
 * Accepts any of these per team:
 *  - {att, def}
 *  - {xg, xga}
 *  - {xg_for, xg_against}
 *  - {xg_for, xg_against} (your screenshot shows xg_for)
 */
function normalizeXG(raw) {
  const out = {};
  for (const leagueRaw in raw) {
    const league = cleanName(leagueRaw);
    out[league] = {};

    const teamsObj = raw[leagueRaw] || {};
    for (const teamRaw in teamsObj) {
      const teamName = cleanName(teamRaw);
      const t = teamsObj[teamRaw] || {};

      const att =
        safeNum(t.att) ??
        safeNum(t.xg) ??
        safeNum(t.xg_for) ??
        safeNum(t.xgf) ??
        null;

      const def =
        safeNum(t.def) ??
        safeNum(t.xga) ??
        safeNum(t.xg_against) ??
        safeNum(t.xga_for) ?? // just in case someone used odd keys
        null;

      if (Number.isFinite(att) && Number.isFinite(def)) {
        out[league][teamName] = { att, def };
      }
    }

    // remove empty league
    if (Object.keys(out[league]).length === 0) delete out[league];
  }

  if (Object.keys(out).length === 0) {
    throw new Error("No valid xG found. Check xg_tables.json format.");
  }
  return out;
}

/** ---------- UI builders ---------- */
function populateLeagueDropdown() {
  const sel = $("league");
  sel.innerHTML = `<option value="">Select a league…</option>`;
  Object.keys(xgTables).sort().forEach((league) => {
    const opt = document.createElement("option");
    opt.value = league;
    opt.textContent = league;
    sel.appendChild(opt);
  });
}

function populateTeams() {
  const league = $("league").value;
  const homeSel = $("home");
  const awaySel = $("away");

  homeSel.innerHTML = `<option value="">Select home team…</option>`;
  awaySel.innerHTML = `<option value="">Select away team…</option>`;

  if (!league || !xgTables[league]) return;

  const teams = Object.keys(xgTables[league]).sort();
  teams.forEach((team) => {
    const o1 = document.createElement("option");
    o1.value = team;
    o1.textContent = team;
    homeSel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = team;
    o2.textContent = team;
    awaySel.appendChild(o2);
  });
}

function populateFixturesDropdown() {
  const league = $("league").value;
  const fxSel = $("fixture");
  fxSel.innerHTML = `<option value="">Select a fixture…</option>`;

  if (!league) return;

  const inLeague = fixtures.filter(f => cleanName(f.league) === cleanName(league));
  inLeague.forEach((f, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const d = f.date ? ` (${f.date})` : "";
    opt.textContent = `${f.home} vs ${f.away}${d}`;
    fxSel.appendChild(opt);
  });

  // show list of today's fixtures box
  const today = $("today");
  if (inLeague.length === 0) {
    today.textContent = "No fixtures in this league (fixtures.json).";
  } else {
    today.innerHTML = inLeague.slice(0, 12).map(f => `• ${f.home} vs ${f.away}${f.date ? " — " + f.date : ""}`).join("<br>");
  }
}

function applyFixtureSelection() {
  const league = $("league").value;
  const fxSel = $("fixture").value;
  if (!league || fxSel === "") return;

  const inLeague = fixtures.filter(f => cleanName(f.league) === cleanName(league));
  const f = inLeague[Number(fxSel)];
  if (!f) return;

  // set dropdown values if exist
  $("home").value = f.home;
  $("away").value = f.away;
  renderH2H(); // update h2h box
}

/** ---------- prediction core ---------- */
function poissonSample(lambda) {
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function computeLambdas(league, home, away) {
  const H = xgTables[league]?.[home];
  const A = xgTables[league]?.[away];
  if (!H || !A) return null;

  // Simple blend: home attack with away defense, away attack with home defense
  // You can improve later. This is stable + works.
  const homeXG = (H.att + A.def) / 2;
  const awayXG = (A.att + H.def) / 2;

  // guardrails
  return {
    homeXG: Math.max(0.05, Math.min(4.5, homeXG)),
    awayXG: Math.max(0.05, Math.min(4.5, awayXG)),
  };
}

function runMonteCarlo(homeXG, awayXG, sims) {
  const scoreCounts = new Map(); // "h-a" -> count
  let homeWin = 0, draw = 0, awayWin = 0;
  let over25 = 0, btts = 0;

  for (let i = 0; i < sims; i++) {
    const h = poissonSample(homeXG);
    const a = poissonSample(awayXG);

    const key = `${h}-${a}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);

    if (h > a) homeWin++;
    else if (h === a) draw++;
    else awayWin++;

    if (h + a >= 3) over25++;
    if (h >= 1 && a >= 1) btts++;
  }

  // top scorelines
  const top = [...scoreCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([k, c]) => ({ score: k, p: c / sims }));

  return {
    top,
    pHome: homeWin / sims,
    pDraw: draw / sims,
    pAway: awayWin / sims,
    pOver25: over25 / sims,
    pBTTS: btts / sims,
  };
}

/** ---------- H2H ---------- */
function findH2H(league, home, away) {
  const L = keyName(league);
  const h = keyName(home);
  const a = keyName(away);

  // allow either order
  const hits = h2hList.filter(x => {
    const xl = x.league ? keyName(x.league) : L;
    const xh = keyName(x.home);
    const xa = keyName(x.away);
    const sameLeague = !x.league || xl === L;
    const direct = (xh === h && xa === a);
    const reverse = (xh === a && xa === h);
    return sameLeague && (direct || reverse);
  });

  // newest first if date exists
  hits.sort((p, q) => (q.date || "").localeCompare(p.date || ""));
  return hits[0] || null;
}

function renderH2H() {
  const league = $("league").value;
  const home = $("home").value;
  const away = $("away").value;
  const box = $("h2h");
  if (!league || !home || !away) { box.textContent = "—"; return; }

  const h = findH2H(league, home, away);
  if (!h) {
    box.textContent = "No H2H found in h2h.json for this matchup.";
    return;
  }

  const parts = [];
  if (h.date) parts.push(`<b>${h.date}</b>`);
  parts.push(`<b>${h.home}</b> vs <b>${h.away}</b> — <b>${h.score || "?"}</b>`);
  if (h.corners != null) parts.push(`Corners: <b>${h.corners}</b>`);
  if (h.cards != null) parts.push(`Cards: <b>${h.cards}</b>`);

  box.innerHTML = parts.join("<br>");
}

/** ---------- main run ---------- */
window.runPrediction = function runPrediction() {
  try {
    const league = $("league").value;
    const home = $("home").value;
    const away = $("away").value;

    const simsRaw = Number($("sims").value || 10000);
    const sims = Number.isFinite(simsRaw) ? Math.max(1000, Math.min(200000, Math.floor(simsRaw))) : 10000;

    if (!league || !home || !away) {
      alert("Select league, home team, and away team.");
      return;
    }
    if (home === away) {
      alert("Home and Away cannot be the same team.");
      return;
    }

    const lambdas = computeLambdas(league, home, away);
    if (!lambdas) {
      alert(`Team not found in xG table.\nMake sure league + team names exist in xg_tables.json.`);
      return;
    }

    const { homeXG, awayXG } = lambdas;
    const mc = runMonteCarlo(homeXG, awayXG, sims);

    renderH2H();

    const out = $("output");
    const pct = (x) => (100 * x).toFixed(1) + "%";

    out.innerHTML = `
      <div><b>${home}</b> vs <b>${away}</b> <span class="muted mono">(${league})</span></div>
      <div class="muted mono" style="margin-top:6px;">λ Home: ${homeXG.toFixed(2)} | λ Away: ${awayXG.toFixed(2)} | sims: ${sims.toLocaleString()}</div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,.14);margin:10px 0;">
      <div><b>1X2</b> — Home ${pct(mc.pHome)} | Draw ${pct(mc.pDraw)} | Away ${pct(mc.pAway)}</div>
      <div><b>O/U 2.5</b> — Over ${pct(mc.pOver25)} | Under ${pct(1 - mc.pOver25)}</div>
      <div><b>BTTS</b> — Yes ${pct(mc.pBTTS)} | No ${pct(1 - mc.pBTTS)}</div>
      <div style="margin-top:8px;"><b>Top scorelines</b></div>
      <div class="muted mono">${mc.top.map(x => `${x.score} (${pct(x.p)})`).join(" • ")}</div>
    `;
  } catch (e) {
    console.error(e);
    alert("Error running prediction. Open console to see details.");
  }
};

/** ---------- boot ---------- */
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

async function init() {
  // default: disable run until xG loaded
  $("run").disabled = true;

  // load xG
  try {
    const rawXG = await loadJSON("xg_tables.json");
    xgTables = normalizeXG(rawXG);
    setStatus("xg-status", `✅ xG loaded (${Object.keys(xgTables).length} leagues)`, "❌ xG failed", true);
  } catch (e) {
    console.error(e);
    setStatus("xg-status", "❌ xG failed", "❌ xG failed", false);
    alert(e.message);
    return;
  }

  // load fixtures (optional)
  try {
    const rawFx = await loadJSON("fixtures.json");
    fixtures = Array.isArray(rawFx) ? rawFx : (rawFx.fixtures || []);
    fixtures = fixtures.map(f => ({
      league: cleanName(f.league),
      home: cleanName(f.home),
      away: cleanName(f.away),
      date: f.date ? cleanName(f.date) : ""
    })).filter(f => f.league && f.home && f.away);
    setStatus("fx-status", `✅ fixtures loaded (${fixtures.length})`, "⚠️ fixtures missing", true);
  } catch (e) {
    console.warn("fixtures.json not loaded:", e.message);
    fixtures = [];
    setStatus("fx-status", "⚠️ fixtures missing", "⚠️ fixtures missing", false);
  }

  // load h2h (optional)
  try {
    const rawH2H = await loadJSON("h2h.json");
    h2hList = Array.isArray(rawH2H) ? rawH2H : (rawH2H.h2h || []);
    h2hList = h2hList.map(x => ({
      league: x.league ? cleanName(x.league) : "",
      home: cleanName(x.home),
      away: cleanName(x.away),
      score: x.score ? cleanName(x.score) : "",
      corners: x.corners ?? null,
      cards: x.cards ?? null,
      date: x.date ? cleanName(x.date) : ""
    })).filter(x => x.home && x.away);
    setStatus("h2h-status", `✅ H2H loaded (${h2hList.length})`, "⚠️ H2H missing", true);
  } catch (e) {
    console.warn("h2h.json not loaded:", e.message);
    h2hList = [];
    setStatus("h2h-status", "⚠️ H2H missing", "⚠️ H2H missing", false);
  }

  // build UI
  populateLeagueDropdown();
  $("league").addEventListener("change", () => {
    populateTeams();
    populateFixturesDropdown();
    renderH2H();
  });

  $("fixture").addEventListener("change", () => {
    applyFixtureSelection();
  });

  $("home").addEventListener("change", renderH2H);
  $("away").addEventListener("change", renderH2H);

  $("run").disabled = false;
}

init();
