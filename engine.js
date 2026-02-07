// engine.js — MatchQuant REAL Engine (Poisson goals + 1X2 + O/U + BTTS + Cards/Corners totals)
// Exposes: window.MQ.predictMatchInternal(payload)

(() => {
  console.log("✅ MatchQuant REAL engine loaded");

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

  function fairOdds(p) {
    const pp = Number(p);
    if (!Number.isFinite(pp) || pp <= 0) return null;
    return +(1 / pp).toFixed(2);
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

    // normalize truncated tail mass
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
      home, draw, away,
      homeOdds: fairOdds(home),
      drawOdds: fairOdds(draw),
      awayOdds: fairOdds(away),
    };
  }

  function calcOverUnder(grid, line = 2.5) {
    let over = 0, under = 0;
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
    return { over, under, overOdds: fairOdds(over), underOdds: fairOdds(under) };
  }

  function calcBTTS(grid) {
    let yes = 0, no = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > 0 && a > 0) yes += p;
        else no += p;
      }
    }
    return { yes, no, yesOdds: fairOdds(yes), noOdds: fairOdds(no) };
  }

  // 1D totals (cards/corners)
  function build1DTotal(lambda, cap = 30) {
    const c = clamp(parseInt(cap || 30, 10), 10, 80);
    const probs = new Array(c + 1).fill(0);

    let sum = 0;
    for (let k = 0; k <= c; k++) {
      const p = poissonPMF(k, lambda);
      probs[k] = p;
      sum += p;
    }

    if (sum > 0) for (let k = 0; k <= c; k++) probs[k] /= sum;

    let bestK = 0, bestP = probs[0];
    for (let k = 1; k <= c; k++) {
      if (probs[k] > bestP) { bestP = probs[k]; bestK = k; }
    }

    return { lambda, cap: c, probs, mostLikelyTotal: { k: bestK, p: bestP } };
  }

  function ou1D(total, line) {
    let over = 0, under = 0;
    for (let k = 0; k < total.probs.length; k++) {
      const p = total.probs[k];
      if (k > line) over += p;
      else under += p;
    }
    return { over, under, overOdds: fairOdds(over), underOdds: fairOdds(under) };
  }

  function toFiniteOrNull(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function predictMatchInternal(payload) {
    // ----- GOALS -----
    const xgHome = Number(payload.xgHome ?? 1.35);
    const xgAway = Number(payload.xgAway ?? 1.35);

    const leagueMult = Number(payload.leagueMult ?? 1.0);
    const homeAdv = Number(payload.homeAdv ?? 1.10);
    const goalCap = clamp(parseInt(payload.goalCap ?? 8, 10), 4, 12);

    let lamH = xgHome * leagueMult * homeAdv;
    let lamA = xgAway * leagueMult;

    lamH = clamp(lamH, 0.15, 3.75);
    lamA = clamp(lamA, 0.15, 3.75);

    const { grid } = buildScoreGrid(lamH, lamA, goalCap);

    const mostLikely = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    // ----- CARDS / CORNERS -----
    const cardsHome = toFiniteOrNull(payload.cardsHome);
    const cardsAway = toFiniteOrNull(payload.cardsAway);
    const cornersHome = toFiniteOrNull(payload.cornersHome);
    const cornersAway = toFiniteOrNull(payload.cornersAway);

    const haveCards = cardsHome !== null && cardsAway !== null;
    const haveCorners = cornersHome !== null && cornersAway !== null;

    // If missing, use league-typical defaults (you can tune these)
    const cardsTotalLam = haveCards ? clamp(cardsHome + cardsAway, 1.5, 12.0) : 4.6;
    const cornersTotalLam = haveCorners ? clamp(cornersHome + cornersAway, 4.0, 22.0) : 9.8;

    const cardsTotal = build1DTotal(cardsTotalLam, 25);
    const cornersTotal = build1DTotal(cornersTotalLam, 40);

    return {
      lamH,
      lamA,
      mostLikely,
      x12,
      ou25,
      btts,

      // Keep team inputs so UI can show them
      cardsHome,
      cardsAway,
      cornersHome,
      cornersAway,

      cards: {
        lambdaTotal: cardsTotalLam,
        mostLikelyTotal: cardsTotal.mostLikelyTotal,
        ou45: ou1D(cardsTotal, 4.5),
      },

      corners: {
        lambdaTotal: cornersTotalLam,
        mostLikelyTotal: cornersTotal.mostLikelyTotal,
        ou95: ou1D(cornersTotal, 9.5),
      },
    };
  }

  window.MQ = window.MQ || {};
  window.MQ.predictMatchInternal = predictMatchInternal;
})();
