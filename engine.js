// engine.js — MatchQuant Engine (Upgraded)
// Exposes: window.MQ.predictMatchInternal(payload)
// Sync output for app.js

(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // --- math helpers ---
  function factorial(n) {
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
    if (!p || p <= 0) return null;
    return +(1 / p).toFixed(2);
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

    // normalize (in case cap truncation loses mass)
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
    return { home, draw, away };
  }

  function calcOverUnder(grid, line = 2.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const total = h + a;
        if (total > line) over += p;
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

  // Asian Handicap probability (simple, no pushes unless line is integer)
  // Returns {cover, push, fail, coverOdds}
  function calcAH(grid, side = "home", line = -0.5) {
    let cover = 0, push = 0, fail = 0;

    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];

        // score diff from home view
        const diff = h - a;

        // apply handicap to chosen side
        const adj = side === "home" ? (diff + line) : (-diff + line);

        if (adj > 0) cover += p;
        else if (adj === 0) push += p;
        else fail += p;
      }
    }

    // fair odds for "cover" (ignoring pushes)
    const eff = 1 - push;
    const coverNoPush = eff > 0 ? cover / eff : 0;

    return {
      cover,
      push,
      fail,
      coverOdds: fairOdds(coverNoPush),
    };
  }

  // Team totals from grid
  function calcTeamTotal(grid, team = "home", line = 1.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];

        const goals = team === "home" ? h : a;
        if (goals > line) over += p;
        else under += p;
      }
    }
    return { over, under, overOdds: fairOdds(over), underOdds: fairOdds(under) };
  }

  function buildTotalsPack(grid) {
    const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
    const out = {};
    lines.forEach((ln) => (out[String(ln)] = calcOverUnder(grid, ln)));
    return out;
  }

  function buildTeamTotalsPack(grid) {
    const lines = [0.5, 1.5, 2.5, 3.5];
    const out = { home: {}, away: {} };
    lines.forEach((ln) => {
      out.home[String(ln)] = calcTeamTotal(grid, "home", ln);
      out.away[String(ln)] = calcTeamTotal(grid, "away", ln);
    });
    return out;
  }

  function buildAHPack(grid) {
    const lines = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5];
    const out = { home: {}, away: {} };
    lines.forEach((ln) => {
      out.home[String(ln)] = calcAH(grid, "home", ln);
      out.away[String(ln)] = calcAH(grid, "away", ln);
    });
    return out;
  }

  // IMPORTANT: app.js calls this synchronously
  function predictMatchInternal(payload) {
    const xgHome = Number(payload.xgHome ?? 1.35);
    const xgAway = Number(payload.xgAway ?? 1.35);

    const leagueMult = Number(payload.leagueMult ?? 1.0);
    const homeAdv = Number(payload.homeAdv ?? 1.10);
    const goalCap = Number(payload.goalCap ?? 8);

    // Final lambdas
    let lamH = xgHome * leagueMult * homeAdv;
    let lamA = xgAway * leagueMult;

    lamH = clamp(lamH, 0.15, 3.75);
    lamA = clamp(lamA, 0.15, 3.75);

    const { grid } = buildScoreGrid(lamH, lamA, goalCap);

    const mostLikely = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    // ADD-ONS
    const totals = buildTotalsPack(grid);
    const teamTotals = buildTeamTotalsPack(grid);
    const ah = buildAHPack(grid);

    return {
      lamH,
      lamA,
      mostLikely,
      x12,
      ou25,
      btts,
      totals,      // totals["2.5"].overOdds etc
      teamTotals,  // teamTotals.home["1.5"].overOdds
      ah,          // ah.home["-0.5"].coverOdds
    };
  }

  window.MQ = window.MQ || {};
  window.MQ.predictMatchInternal = predictMatchInternal;
})();
