/* =========================
   MatchQuant app.js (FULL)
   ========================= */

let XG = {};
let FIXTURES = [];
let H2H = {};

const qs = (id) => document.getElementById(id);

/* ---------- LOAD DATA ---------- */
async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed ${path}`);
  return res.json();
}

async function init() {
  XG = await loadJSON("./xg_tables.json");
  FIXTURES = await loadJSON("./fixtures.json").catch(() => []);
  H2H = await loadJSON("./h2h.json").catch(() => ({}));

  populateLeagues();
  qs("statusLine").textContent = `xG loaded ✓ (${Object.keys(XG).length} leagues)`;
}

init();

/* ---------- UI SETUP ---------- */
function populateLeagues() {
  const sel = qs("leagueSelect");
  sel.innerHTML = "";
  Object.keys(XG).forEach((lg) => {
    const o = document.createElement("option");
    o.value = lg;
    o.textContent = lg;
    sel.appendChild(o);
  });
  sel.addEventListener("change", populateTeams);
  populateTeams();
}

function populateTeams() {
  const lg = qs("leagueSelect").value;
  const list = qs("teamsList");
  list.innerHTML = "";
  if (!XG[lg]) return;

  Object.keys(XG[lg]).forEach((t) => {
    const o = document.createElement("option");
    o.value = t;
    list.appendChild(o);
  });
}

/* ---------- MATH ---------- */
function poisson(lambda) {
  let L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function simulate(homeXG, awayXG, sims) {
  let H = 0, D = 0, A = 0;
  let scores = {};
  let over25 = 0;

  for (let i = 0; i < sims; i++) {
    const hg = poisson(homeXG);
    const ag = poisson(awayXG);

    if (hg > ag) H++;
    else if (hg === ag) D++;
    else A++;

    if (hg + ag > 2.5) over25++;

    const key = `${hg}-${ag}`;
    scores[key] = (scores[key] || 0) + 1;
  }

  const total = sims;
  return {
    H: H / total,
    D: D / total,
    A: A / total,
    over25: over25 / total,
    scores
  };
}

/* ---------- EV ---------- */
function ev(prob, odds) {
  if (!odds) return null;
  return prob * odds - 1;
}

function evBadge(v) {
  if (v === null) return "—";
  if (v > 0.05) return "🟢 Green";
  if (v > -0.05) return "🟡 Yellow";
  return "🔴 Red";
}

/* ---------- CONFIDENCE ---------- */
function tier(edge) {
  if (edge > 0.12) return "Tier 1 (Strong)";
  if (edge > 0.07) return "Tier 2 (Playable)";
  if (edge > 0.03) return "Tier 3 (Lean)";
  return "Tier 4 (No edge)";
}

/* ---------- MAIN RUN ---------- */
qs("runBtn").addEventListener("click", () => {
  const lg = qs("leagueSelect").value;
  const home = qs("homeTeam").value;
  const away = qs("awayTeam").value;
  const sims = +qs("sims").value || 10000;

  if (!XG[lg] || !XG[lg][home] || !XG[lg][away]) {
    qs("statusLine").textContent = "Invalid teams for league";
    return;
  }

  const homeXG = XG[lg][home].xg;
  const awayXG = XG[lg][away].xg;

  const res = simulate(homeXG, awayXG, sims);

  /* ---------- SCORELINES ---------- */
  const topScores = Object.entries(res.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, c]) => `${s} (${(c / sims * 100).toFixed(1)}%)`)
    .join(", ");

  /* ---------- ASIAN ---------- */
  let ah = "0 (Draw No Bet lean)";
  if (res.H > 0.55) ah = "Home -0.5";
  else if (res.A > 0.45) ah = "Away +0.5";

  /* ---------- EV FLAGS ---------- */
  const evHome = ev(res.H, +qs("oddsMlHome").value || null);
  const evOver = ev(res.over25, +qs("oddsOuOver").value || null);

  /* ---------- H2H ---------- */
  const h2hKey = `${home} vs ${away}`;
  const lastH2H = H2H[h2hKey] || "—";

  /* ---------- OUTPUT ---------- */
  qs("rLeague").textContent = lg;
  qs("rMatch").textContent = `${home} vs ${away}`;
  qs("rXg").textContent = `Home λ ${homeXG.toFixed(2)} / Away λ ${awayXG.toFixed(2)}`;

  const bestScore = Object.entries(res.scores).sort((a, b) => b[1] - a[1])[0][0];
  qs("rScore").textContent = bestScore;

  qs("rOu").textContent = res.over25 > 0.5
    ? `Over (${(res.over25 * 100).toFixed(0)}%)`
    : `Under (${((1 - res.over25) * 100).toFixed(0)}%)`;

  qs("rAh").textContent = ah;

  qs("rWin").textContent =
    `H ${(res.H * 100).toFixed(0)}% / D ${(res.D * 100).toFixed(0)}% / A ${(res.A * 100).toFixed(0)}%`;

  qs("rEv").textContent =
    `ML Home: ${evBadge(evHome)} | O2.5: ${evBadge(evOver)}`;

  const bestEdge = Math.max(evHome || -1, evOver || -1);
  qs("rTier").textContent = tier(bestEdge);

  qs("rTop").textContent = topScores;

  qs("statusLine").textContent = "Prediction complete ✓";
});

/* ---------- RUN ALL LEAGUES ---------- */
qs("runAllBtn").addEventListener("click", () => {
  qs("statusLine").textContent = "Running all leagues from fixtures.json…";
});
