/* MatchQuant engine.js — OPTION B (DETERMINISTIC POISSON, no Monte Carlo) */

window.runPrediction = function (p) {
  const {
    league, home, away,
    homeAdv, baseGoals, capGoals,
    xgRaw
  } = p;

  // --- helpers ---
  function clampInt(n, lo, hi) {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function teamXG(team) {
    // supports xgRaw.leagues[league][team] or xgRaw[league][team]
    const root = xgRaw?.leagues || xgRaw;
    const v = root?.[league]?.[team]?.xGF;
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : baseGoals;
  }

  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonP(k, mu) {
    // P(X=k) = e^-mu * mu^k / k!
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  // --- inputs ---
  const cap = clampInt(capGoals, 0, 12); // 0..12 safe grid
  const muHome = teamXG(home) * Number(homeAdv || 1.10);
  const muAway = teamXG(away);

  // --- compute joint distribution over score grid ---
  let bestScore = "0-0";
  let bestProb = -1;

  let pHomeWin = 0;
  let pDraw = 0;
  let pAwayWin = 0;

  // Precompute marginals up to cap
  const ph = [];
  const pa = [];
  for (let i = 0; i <= cap; i++) {
    ph[i] = poissonP(i, muHome);
    pa[i] = poissonP(i, muAway);
  }

  // Joint assuming independence
  for (let hg = 0; hg <= cap; hg++) {
    for (let ag = 0; ag <= cap; ag++) {
      const pr = ph[hg] * pa[ag];

      if (pr > bestProb) {
        bestProb = pr;
        bestScore = `${hg}-${ag}`;
      }

      if (hg > ag) pHomeWin += pr;
      else if (hg === ag) pDraw += pr;
      else pAwayWin += pr;
    }
  }

  // Because we cap at capGoals, there is some probability mass beyond the grid.
  // We normalize to the grid so probabilities add to 100% on what we modeled.
  const totalModeled = pHomeWin + pDraw + pAwayWin;
  const norm = totalModeled > 0 ? totalModeled : 1;

  pHomeWin /= norm;
  pDraw /= norm;
  pAwayWin /= norm;

  // --- output ---
  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities (Poisson, deterministic):\n` +
    `${home}: ${(pHomeWin * 100).toFixed(1)}%\n` +
    `Draw: ${(pDraw * 100).toFixed(1)}%\n` +
    `${away}: ${(pAwayWin * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${bestScore}\n\n` +
    `xG Model (means):\n` +
    `${home}: ${muHome.toFixed(2)}\n` +
    `${away}: ${muAway.toFixed(2)}`
  );
};
