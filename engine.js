/* ===========================
   MatchQuant Engine v1
   =========================== */

// Utility
function num(x, d = 0) {
  const n = Number(x);
  return isFinite(n) ? n : d;
}

// Very simple Poisson helper
function poissonP(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Core engine (THIS is what app.js should call)
function runEngine(payload) {
  const {
    leagueName,
    homeTeam,
    awayTeam,
    homeXG,
    awayXG
  } = payload;

  if (!homeTeam || !awayTeam) {
    return `<div class="card">
      <b>Error:</b> Team selection missing.
    </div>`;
  }

  const λh = num(homeXG, 1.4);
  const λa = num(awayXG, 1.2);

  // Score probabilities (0–4)
  let best = { p: 0, h: 0, a: 0 };
  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) {
      const p = poissonP(λh, h) * poissonP(λa, a);
      if (p > best.p) best = { p, h, a };
    }
  }

  const homeWin = 0.405;
  const draw = 0.25;
  const awayWin = 0.345;

  return `
  <div class="card">
    <div style="font-size:1.1rem;font-weight:700;">
      ${leagueName}: ${homeTeam} vs ${awayTeam}
    </div>

    <div style="margin-top:10px;">
      <b>Expected Goals (xG-based λ):</b>
      ${λh.toFixed(2)} – ${λa.toFixed(2)}
    </div>

    <div style="margin-top:10px;">
      <b>Most likely score:</b>
      ${best.h}-${best.a}
      (p=${(best.p * 100).toFixed(1)}%)
    </div>

    <div style="margin-top:10px;">
      <b>1X2:</b>
      Home ${(homeWin * 100).toFixed(1)}% |
      Draw ${(draw * 100).toFixed(1)}% |
      Away ${(awayWin * 100).toFixed(1)}%
    </div>

    <div style="margin-top:10px;">
      <b>Lean:</b> No strong edge
    </div>
  </div>`;
}

/* ---- EXPOSE ENGINE ---- */
window.runEngine = runEngine;

/* ---- UI BRIDGE (what app.js calls) ---- */
window.runMatchQuant = function (payload) {
  try {
    return runEngine(payload);
  } catch (e) {
    return `<div class="card">
      <b>Engine error:</b> ${e.message}
    </div>`;
  }
};
