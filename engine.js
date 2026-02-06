// engine.js — MatchQuant Engine
// Exposes: window.MQ.predictMatchInternal(payload)

(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }

  function buildScoreGrid(lamH, lamA, goalCap = 8) {
    const cap = clamp(parseInt(goalCap || 8, 10), 4, 12);
    const grid = {};
    let sum = 0;

    for (let h = 0; h <= cap; h++) {
      grid[h] = {};
      const ph = poissonPMF(h, lamH);
      for (let a = 0; a <= cap; a++) {
        const pa = poissonPMF(a, lamA);
        const p = ph * pa;
        grid[h][a] = p;
        sum += p;
      }
    }

    // normalize
    if (sum > 0) {
      for (let h = 0; h <= cap; h++) {
        for (let a = 0; a <= cap; a++) grid[h][a] /= sum;
      }
    }

    return grid;
  }

  function mostLikelyScore(grid) {
    let best = { h: 0, a: 0, p: -1 };
    for (const hStr of Object.keys(grid)) {
      for (const aStr of Object.keys(grid[hStr])) {
        const p = grid[hStr][aStr];
        if (p > best.p) best = { h: Number(hStr), a: Number(aStr), p };
      }
    }
    return best;
  }

  function calc1X2(grid) {
    let home = 0, draw = 0, away = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      for (const aStr of Object.keys(grid[hStr])) {
        const a = Number(aStr);
        const p = grid[hStr][aStr];
        if (h > a) home += p;
        else if (h === a) draw += p;
        else away += p;
      }
    }
    return { home, draw, away };
  }

  function calcOverUnder(grid, line = 2.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      for (const aStr of Object.keys(grid[hStr])) {
        const a = Number(aStr);
        const p = grid[hStr][aStr];
        if (h + a > line) over += p;
        else under += p;
      }
    }
    return { over, under };
  }

  function calcBTTS(grid) {
    let yes = 0, no = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      for (const aStr of Object.keys(grid[hStr])) {
        const a = Number(aStr);
        const p = grid[hStr][aStr];
        if (h > 0 && a > 0) yes += p;
        else no += p;
      }
    }
    return { yes, no };
  }

  // IMPORTANT: app.js calls this synchronously
  function predictMatchInternal(payload) {
    const xgHome = Number(payload.xgHome || 1.2);
    const xgAway = Number(payload.xgAway || 1.1);

    const leagueMult = Number(payload.leagueMult || 1.0);
    const homeAdv = Number(payload.homeAdv || 1.10);
    const goalCap = Number(payload.goalCap || 8);

    // Final lambdas
    let lamH = xgHome * leagueMult * homeAdv;
    let lamA = xgAway * leagueMult;

    lamH = clamp(lamH, 0.15, 3.75);
    lamA = clamp(lamA, 0.15, 3.75);

    const grid = buildScoreGrid(lamH, lamA, goalCap);

    const mostLikely = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    return { lamH, lamA, mostLikely, x12, ou25, btts };
  }

  window.MQ = window.MQ || {};
  window.MQ.predictMatchInternal = predictMatchInternal;
})();
