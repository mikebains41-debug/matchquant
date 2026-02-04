/* =========================
   MatchQuant Core Engine
   Features 1–6 Enabled
========================= */

let xgTables = {};
let fixtures = {};
let h2hData = {};

/* ---------- LOAD DATA ---------- */
async function loadJSON() {
  xgTables = await fetch("xg_tables.json").then(r => r.json());
  fixtures = await fetch("fixtures.json").then(r => r.json());
  h2hData = await fetch("h2h.json").then(r => r.json());
}
loadJSON();

/* ---------- POISSON ---------- */
function poisson(lambda) {
  let L = Math.exp(-lambda);
  let p = 1, k = 0;
  while (p > L) {
    k++;
    p *= Math.random();
  }
  return k - 1;
}

/* ---------- MONTE CARLO ---------- */
function monteCarlo(homeλ, awayλ, sims = 10000) {
  let scores = {};
  let H = 0, D = 0, A = 0;

  for (let i = 0; i < sims; i++) {
    let h = poisson(homeλ);
    let a = poisson(awayλ);
    let key = `${h}-${a}`;
    scores[key] = (scores[key] || 0) + 1;
    if (h > a) H++;
    else if (h < a) A++;
    else D++;
  }

  let topScores = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, c]) => `${s} (${(c / sims * 100).toFixed(1)}%)`);

  return {
    probs: {
      H: (H / sims * 100).toFixed(0),
      D: (D / sims * 100).toFixed(0),
      A: (A / sims * 100).toFixed(0)
    },
    topScores
  };
}

/* ---------- EV BADGE ---------- */
function evBadge(prob, odds) {
  if (!odds) return "—";
  let ev = prob / 100 * odds;
  if (ev > 1.05) return "🟢 Positive EV";
  if (ev > 0.98) return "🟡 Marginal";
  return "🔴 Negative EV";
}

/* ---------- CONFIDENCE TIER ---------- */
function confidenceTier(p) {
  if (p >= 65) return "Tier 1 (Strong)";
  if (p >= 58) return "Tier 2 (Good)";
  if (p >= 52) return "Tier 3 (Lean)";
  return "Tier 4 (No edge)";
}

/* ---------- AUTO FIXTURES ---------- */
function todayFixtures(league) {
  let today = new Date().toISOString().slice(0, 10);
  return (fixtures[league] || []).filter(f => f.date === today);
}

/* ---------- RUN PREDICTION ---------- */
window.runPrediction = function () {
  let league = document.getElementById("league").value;
  let home = document.getElementById("homeTeam").value;
  let away = document.getElementById("awayTeam").value;

  let homeλ = xgTables[league][home];
  let awayλ = xgTables[league][away];

  let mc = monteCarlo(homeλ, awayλ);
  let tier = confidenceTier(Math.max(mc.probs.H, mc.probs.A));

  document.getElementById("resLeague").innerText = league;
  document.getElementById("resMatch").innerText = `${home} vs ${away}`;
  document.getElementById("resXG").innerText = `Home λ ${homeλ} / Away λ ${awayλ}`;
  document.getElementById("resScore").innerText = mc.topScores[0].split(" ")[0];
  document.getElementById("resOU").innerText = "Calculated via MC";
  document.getElementById("resAH").innerText = "Model-based";
  document.getElementById("resWin").innerText =
    `H ${mc.probs.H}% / D ${mc.probs.D}% / A ${mc.probs.A}%`;
  document.getElementById("resTier").innerText = tier;
  document.getElementById("resTop").innerText = mc.topScores.join(", ");

  /* EV */
  let mlHomeOdds = parseFloat(document.getElementById("oddsHome").value);
  document.getElementById("resEV").innerText =
    evBadge(mc.probs.H, mlHomeOdds);
};

/* ---------- AUTO TODAY MODE ---------- */
window.runToday = function () {
  let league = document.getElementById("league").value;
  let games = todayFixtures(league);
  if (!games.length) alert("No fixtures today in this league.");
};
