// engine.js — MatchQuant Engine (drop-in, GitHub Pages safe)
// Goals + 1X2 + O/U + BTTS + Totals + TeamTotals + Asian Handicap (quarter lines) + Cards + Corners
// Exposes: window.MQ.predictMatchInternal(payload)

(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // -------------------------
  // Math
  // -------------------------
  function factorial(n) {
    n = n | 0;
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }

  function fairOddsFromProb(p) {
    p = Number(p);
    if (!Number.isFinite(p) || p <= 0) return null;
    return +(1 / p).toFixed(2);
  }

  // -------------------------
  // Score grid
  // -------------------------
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

    // normalize (cap truncation loses tail mass)
    if (sum > 0) {
      for (let h = 0; h <= cap; h++) {
        for (let a = 0; a <= cap; a++) grid[h][a] /= sum;
      }
    }

    return { grid, cap };
  }

  function mostLikelyScore(grid) {
    let best = { h: 0, a: 0, p: -1 };
    for (const hStr of Object.keys(grid)) {
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const p = row[aStr];
        if (p > best.p) best = { h: Number(hStr), a: Number(aStr), p };
      }
    }
    return best;
  }

  function calc1X2(grid) {
    let home = 0, draw = 0, away = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > a) home += p;
        else if (h === a) draw += p;
        else away += p;
      }
    }
    return {
      home,
      draw,
      away,
      homeOdds: fairOddsFromProb(home),
      drawOdds: fairOddsFromProb(draw),
      awayOdds: fairOddsFromProb(away),
    };
  }

  function calcOverUnder(grid, line = 2.5) {
    let over = 0,
      under = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h + a > line) over += p;
        else under += p;
      }
    }
    return { over, under, overOdds: fairOddsFromProb(over), underOdds: fairOddsFromProb(under) };
  }

  function calcBTTS
