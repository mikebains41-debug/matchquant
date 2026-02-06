/* MatchQuant engine.js
   - xG-driven rates with fallback
   - league strength multipliers
   - Poisson score probs + key markets
*/

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function poissonP(k, lambda) {
  // P(k) = e^-λ λ^k / k!
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
}

function buildScoreMatrix(lh, la, cap = 10) {
  const m = [];
  for (let i = 0; i <= cap; i++) {
    m[i] = [];
    for (let j = 0; j <= cap; j++) {
      m[i][j] = poissonP(i, lh) * poissonP(j, la);
    }
  }
  return m;
}

function sumMatrix(m, fn) {
  let s = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      if (fn(i, j)) s += m[i][j];
    }
  }
  return s;
}

// ---------- xG helpers ----------
function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "")
    .replace(/\./g, "");
}

// Expected shape options supported:
// xgData[league][team] = { xg_for, xg_against }  OR
// xgData[league][team] = { xGF, xGA }           OR
// xgData[league][team] = { xg, xga }
function getTeamXG(xgData, league, team) {
  if (!xgData || !xgData[league]) return null;

  const table = xgData[league];

  // try direct
  if (table[team]) return table[team];

  // try normalized lookup
  const tKey = normKey(team);
  const keys = Object.keys(table);
  for (const k of keys) {
    if (normKey(k) === tKey) return table[k];
  }
  return null;
}

function readXGPair(obj) {
  if (!obj) return null;

  const xf =
    obj.xg_for ?? obj.xGF ?? obj.xg ?? obj.for ?? obj.attack ?? null;
  const xa =
    obj.xg_against ?? obj.xGA ?? obj.xga ?? obj.against ?? obj.defense ?? null;

  if (xf == null || xa == null) return null;
  return { xGF: Number(xf), xGA: Number(xa) };
}

function leagueAverages(xgData, league) {
  if (!xgData || !xgData[league]) return { avgGF: 1.35, avgGA: 1.35 };

  const table = xgData[league];
  let sumGF = 0;
  let sumGA = 0;
  let n = 0;

  for (const team of Object.keys(table)) {
    const pair = readXGPair(table[team]);
    if (!pair) continue;
    sumGF += pair.xGF;
    sumGA += pair.xGA;
    n++;
  }

  if (!n) return { avgGF: 1.35, avgGA: 1.35 };
  return { avgGF: sumGF / n, avgGA: sumGA / n };
}

function calcLambdas(params) {
  const { league, home, away, baseGoals, homeAdv, xgData, leagueStrength } = params;

  // league multiplier (default 1)
  const mult = Number(leagueStrength?.[league] ?? 1);

  // xG pairs with fallback
  const avg = leagueAverages(xgData, league);

  const hObj = getTeamXG(xgData, league, home);
  const aObj = getTeamXG(xgData, league, away);

  const hPair = readXGPair(hObj) || { xGF: avg.avgGF, xGA: avg.avgGA };
  const aPair = readXGPair(aObj) || { xGF: avg.avgGF, xGA: avg.avgGA };

  // Attack/Defense strengths relative to league average
  const hAtk = hPair.xGF / avg.avgGF;
  const hDef = hPair.xGA / avg.avgGA; // >1 means leaky defense
  const aAtk = aPair.xGF / avg.avgGF;
  const aDef = aPair.xGA / avg.avgGA;

  // Base goal rates
  // Home lambda uses home attack vs away defense; Away uses away attack vs home defense
  let lambdaHome = baseGoals * hAtk * aDef * homeAdv;
  let lambdaAway = baseGoals * aAtk * hDef;

  // apply league multiplier
  lambdaHome *= mult;
  lambdaAway *= mult;

  // clamp for stability
  lambdaHome = clamp(lambdaHome, 0.15, 3.25);
  lambdaAway = clamp(lambdaAway, 0.15, 3.25);

  return { lambdaHome, lambdaAway, avgGF: avg.avgGF, avgGA: avg.avgGA, mult };
}

// ---------- MAIN ----------
window.runPrediction = function runPrediction(params) {
  const { league, home, away, homeRaw, awayRaw, capGoals, pro } = params;

  const { lambdaHome, lambdaAway, mult } = calcLambdas(params);

  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, capGoals);

  const pHome = sumMatrix(matrix, (h, a) => h > a);
  const pDraw = sumMatrix(matrix, (h, a) => h === a);
  const pAway = sumMatrix(matrix, (h, a) => h < a);

  const pOver25 = sumMatrix(matrix, (h, a) => (h + a) >= 3);
  const pBTTS = sumMatrix(matrix, (h, a) => h >= 1 && a >= 1);

  // most likely score
  let best = { h: 0, a: 0, p: -1 };
  for (let h = 0; h <= capGoals; h++) {
    for (let a = 0; a <= capGoals; a++) {
      const p = matrix[h][a];
      if (p > best.p) best = { h, a, p };
    }
  }

  // Simple lean logic
  const mlLean =
    pHome > pAway && pHome > 0.42 ? `${homeRaw} ML lean` :
    pAway > pHome && pAway > 0.42 ? `${awayRaw} ML lean` :
    `Draw / No strong ML edge`;

  const ouLean =
    pOver25 > 0.55 ? `Over 2.5 lean` :
    pOver25 < 0.45 ? `Under 2.5 lean` :
    `2.5 is sharp / no strong edge`;

  // Pro-only extras (client-side gate)
  const proBadge = pro ? `<div style="margin-top:8px; opacity:.85;">✅ Pro unlocked</div>` : "";

  return `
  <div class="card">
    <div style="font-size:1.1rem; font-weight:700;">${league}: ${homeRaw} vs ${awayRaw}</div>

    <div style="margin-top:10px;">
      <div><b>Expected Goals (xG-based λ):</b> ${homeRaw} ${lambdaHome.toFixed(2)} — ${lambdaAway.toFixed(2)} ${awayRaw}</div>
      <div style="opacity:.8;">League multiplier: ${mult.toFixed(2)}</div>
    </div>

    <div style="margin-top:10px;">
      <div><b>Most likely score:</b> ${best.h}-${best.a} (p=${(best.p*100).toFixed(1)}%)</div>
    </div>

    <div style="margin-top:10px;">
      <div><b>1X2:</b> Home ${(pHome*100).toFixed(1)}% | Draw ${(pDraw*100).toFixed(1)}% | Away ${(pAway*100).toFixed(1)}%</div>
      <div><b>O/U 2.5:</b> Over ${(pOver25*100).toFixed(1)}% | Under ${( (1-pOver25)*100 ).toFixed(1)}%</div>
      <div><b>BTTS Yes:</b> ${(pBTTS*100).toFixed(1)}%</div>
    </div>

    <div style="margin-top:10px;">
      <div><b>Leans:</b> ${mlLean}</div>
      <div><b></b> ${ouLean}</div>
    </div>

    ${proBadge}
  </div>
  `;
};
