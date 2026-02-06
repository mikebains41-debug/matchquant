/* MatchQuant Engine - Phase 2 (markets) */

(function () {
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function factorial(n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonPMF(k, lambda) {
    // P(X=k) = e^-λ * λ^k / k!
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }

  function buildScoreGrid(lambdaHome, lambdaAway, goalCap) {
    const cap = clamp(parseInt(goalCap || 8, 10), 4, 12);
    const grid = {}; // grid[h][a] = p

    // raw
    let sum = 0;
    for (let h = 0; h <= cap; h++) {
      grid[h] = {};
      const ph = poissonPMF(h, lambdaHome);
      for (let a = 0; a <= cap; a++) {
        const pa = poissonPMF(a, lambdaAway);
        const p = ph * pa;
        grid[h][a] = p;
        sum += p;
      }
    }

    // normalize (handles cap truncation)
    if (sum > 0) {
      for (let h = 0; h <= cap; h++) {
        for (let a = 0; a <= cap; a++) {
          grid[h][a] /= sum;
        }
      }
    }

    return grid;
  }

  function mostLikelyScore(scoreGrid) {
    let best = { h: 0, a: 0, p: -1 };
    for (const hStr of Object.keys(scoreGrid)) {
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const p = row[aStr];
        if (p > best.p) best = { h: Number(hStr), a: Number(aStr), p };
      }
    }
    return best;
  }

  function calc1X2(scoreGrid) {
    let home = 0, draw = 0, away = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > a) home += p;
        else if (h === a) draw += p;
        else away += p;
      }
    }
    return { home, draw, away };
  }

  function calcOverUnder(scoreGrid, line = 2.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const total = h + a;
        if (total > line) over += p;
        else under += p;
      }
    }
    return {
      over,
      under,
      overOdds: over > 0 ? +(1 / over).toFixed(2) : null,
      underOdds: under > 0 ? +(1 / under).toFixed(2) : null
    };
  }

  function calcBTTS(scoreGrid) {
    let yes = 0, no = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > 0 && a > 0) yes += p;
        else no += p;
      }
    }
    return {
      yes,
      no,
      yesOdds: yes > 0 ? +(1 / yes).toFixed(2) : null,
      noOdds: no > 0 ? +(1 / no).toFixed(2) : null
    };
  }

  function calcAsianHandicap(scoreGrid, side = "home", line = -0.5) {
    let win = 0, lose = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const diff = h - a;

        // For "cover" probability only (no pushes / splits for quarter lines)
        const adj = side === "home" ? (diff + line) : ((-diff) + line);

        if (adj > 0) win += p;
        else lose += p;
      }
    }
    return {
      win,
      lose,
      fairOdds: win > 0 ? +(1 / win).toFixed(2) : null
    };
  }

  function predictMatchInternal(payload) {
    const {
      leagueName,
      homeTeam,
      awayTeam,
      xgHome,
      xgAway,
      leagueMult = 1.0,
      homeAdv = 1.1,
      baseGoals = 1.35,
      goalCap = 8,
      ahSide = "home",
      ahLine = null,
      ahOdds = null
    } = payload;

    // λ (expected goals) – keep it simple and stable:
    // - baseGoals sets typical scoring environment
    // - leagueMult adjusts league tempo
    // - homeAdv adds home boost
    // - xg numbers are treated as relative signal (scaled toward base)
    const safeXgH = Number.isFinite(xgHome) ? xgHome : baseGoals;
    const safeXgA = Number.isFinite(xgAway) ? xgAway : baseGoals;

    // Blend xG with baseGoals so it doesn’t explode
    const blend = 0.65;
    let lamH = (blend * safeXgH + (1 - blend) * baseGoals) * leagueMult * homeAdv;
    let lamA = (blend * safeXgA + (1 - blend) * baseGoals) * leagueMult;

    lamH = clamp(lamH, 0.15, 3.5);
    lamA = clamp(lamA, 0.15, 3.5);

    const grid = buildScoreGrid(lamH, lamA, goalCap);
    const top = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    let ah = null;
    if (ahLine !== null && Number.isFinite(ahLine)) {
      ah = calcAsianHandicap(grid, ahSide, ahLine);
      if (ahOdds && Number.isFinite(ahOdds) && ah.fairOdds) {
        // simple “edge” approximation: if book odds > fair odds => positive
        const fairProb = 1 / ah.fairOdds;
        const bookProb = 1 / ahOdds;
        ah.edge = +(fairProb - bookProb).toFixed(4);
      }
    }

    return {
      leagueName,
      homeTeam,
      awayTeam,
      lamH,
      lamA,
      mostLikely: top,
      x12,
      ou25,
      btts,
      ah
    };
  }

  // expose
  window.MQ = {
    predictMatchInternal
  };
})();
