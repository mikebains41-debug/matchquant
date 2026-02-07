// engine.js — MatchQuant Engine (Goals + Totals + Team Totals + Asian Handicap (quarter lines) + Cards + Corners)
// Exposes: window.MQ.predictMatchInternal(payload)
// NOTE: This is a full replacement for your current engine.js

(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // -------------------------
  // Math helpers
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

  function fairOdds(p) {
    if (!(p > 0)) return null;
    return +(1 / p).toFixed(2);
  }

  // -------------------------
  // Goals grid (home goals x away goals)
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
      home, draw, away,
      homeOdds: fairOdds(home),
      drawOdds: fairOdds(draw),
      awayOdds: fairOdds(away)
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

  // -------------------------
  // Asian Handicap — FAIR ODDS from score grid (supports quarter lines correctly)
  // Returns HOME side W/P/L & DNB fair odds per line
  // -------------------------
  function computeAsianHandicapFair(scoreProb, maxGoals = 10) {
    const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

    // Build goal-diff distribution: diff = H - A, integer range [-maxGoals, +maxGoals]
    const offset = maxGoals;
    const diffProb = Array(2 * maxGoals + 1).fill(0);

    for (let h = 0; h <= maxGoals; h++) {
      const row = scoreProb[h] || {};
      for (let a = 0; a <= maxGoals; a++) {
        const p = Number(row[a] ?? 0);
        if (!p) continue;
        const d = h - a;
        if (d < -maxGoals || d > maxGoals) continue;
        diffProb[d + offset] += p;
      }
    }

    // Prefix sums for fast range queries
    const pref = Array(diffProb.length + 1).fill(0);
    for (let i = 0; i < diffProb.length; i++) pref[i + 1] = pref[i] + diffProb[i];

    const sumIdx = (i0, i1) => {
      i0 = clampInt(i0, 0, diffProb.length - 1);
      i1 = clampInt(i1, 0, diffProb.length - 1);
      if (i1 < i0) return 0;
      return pref[i1 + 1] - pref[i0];
    };

    const P_diff_ge = (x) => sumIdx(x + offset, maxGoals + offset);
    const P_diff_gt = (x) => P_diff_ge(x + 1);
    const P_diff_le = (x) => sumIdx(-maxGoals + offset, x + offset);
    const P_diff_lt = (x) => P_diff_le(x - 1);
    const P_diff_eq = (x) => diffProb[x + offset] ?? 0;

    function evalHalfOrInt(line) {
      let win = 0, push = 0, lose = 0;

      const isInteger = Math.abs(line - Math.round(line)) < 1e-12;
      const isHalf = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12 && !isInteger;

      if (!isInteger && !isHalf) {
        throw new Error("evalHalfOrInt only accepts integer or half lines");
      }

      if (isInteger) {
        // Push when diff + line == 0 => diff == -line
        const t = -Math.round(line);
        win = P_diff_gt(t);
        push = P_diff_eq(t);
        lose = P_diff_lt(t);
        return { win, push, lose };
      }

      // Half line => no push
      const t = -line;                // x.5
      const smallestWin = Math.floor(t) + 1; // first integer > t
      const largestLose = Math.floor(t);     // last integer < t
      win = P_diff_ge(smallestWin);
      push = 0;
      lose = P_diff_le(largestLose);
      return { win, push, lose };
    }

    function isQuarterLine(line) {
      const q = Math.round(line * 4);
      const isQuarterStep = Math.abs(line * 4 - q) < 1e-12;
      const isHalfStep = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12;
      return isQuarterStep && !isHalfStep;
    }

    function homeAhWPL(line) {
      if (!isQuarterLine(line)) return evalHalfOrInt(line);

      // Split stake into two adjacent half-lines
      const lower = Math.floor(line * 2) / 2;
      const upper = lower + 0.5;

      const a = evalHalfOrInt(lower);
      const b = evalHalfOrInt(upper);

      return {
        win: 0.5 * (a.win + b.win),
        push: 0.5 * (a.push + b.push),
        lose: 0.5 * (a.lose + b.lose),
      };
    }

    function toFair(wpl) {
      const win = wpl.win;
      const push = wpl.push;
      const lose = wpl.lose;

      // DNB-adjust: remove pushes
      const denom = win + lose;
      const dnbWinProb = denom > 0 ? win / denom : 0;
      const fair = dnbWinProb > 0 ? 1 / dnbWinProb : null;

      return {
        win,
        push,
        lose,
        dnbWinProb,
        fairOdds: fair == null ? null : +fair.toFixed(2),
      };
    }

    const lines = [
      -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25,
       0,  0.25,  0.5,  0.75,  1,  1.25,  1.5,  1.75, 2
    ];

    return lines.map((line) => {
      const wpl = homeAhWPL(line);
      const f = toFair(wpl);
      return {
        line,
        home_win: +f.win.toFixed(6),
        home_push: +f.push.toFixed(6),
        home_lose: +f.lose.toFixed(6),
        home_dnbWinProb: +f.dnbWinProb.toFixed(6),
        home_fair: f.fairOdds,
      };
    });
  }

  // Build AH pack (home + away) from the fair ladder
  function buildAHPack(grid, goalCap = 8) {
    const cap = clamp(parseInt(goalCap || 8, 10), 4, 12);
    const ladder = computeAsianHandicapFair(grid, cap);

    const out = { home: {}, away: {} };

    // HOME prices already computed
    for (const r of ladder) {
      out.home[String(r.line)] = {
        win: r.home_win,
        push: r.home_push,
        lose: r.home_lose,
        dnbWinProb: r.home_dnbWinProb,
        fairOdds: r.home_fair,
      };
    }

    // AWAY side = mirror the line for home (-line) using the same W/P/L but swapped win/lose
    // Reason: Away +x equals Home -x
    for (const r of ladder) {
      const awayLine = -r.line;
      out.away[String(awayLine)] = {
        win: r.home_lose,
        push: r.home_push,
        lose: r.home_win,
        dnbWinProb: +( (r.home_lose + r.home_win) > 0 ? (r.home_lose / (r.home_lose + r.home_win)) : 0 ).toFixed(6),
        fairOdds: (r.home_lose > 0 ? +(1 / (r.home_lose / (r.home_lose + r.home_win))).toFixed(2) : null),
      };
    }

    return out;
  }

  // -------------------------
  // Team totals packs
  // -------------------------
  function calcTeamTotal(grid, team = "home", line = 1.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(grid)) {
      const h = Number(hStr);
      const row = grid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const g = team === "home" ? h : a;
        if (g > line) over += p;
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

  // -------------------------
  // 1D poisson totals for cards/corners
  // -------------------------
  function build1DTotal(lambda, cap = 30) {
    const c = clamp(parseInt(cap || 30, 10), 10, 60);
    const probs = new Array(c + 1).fill(0);

    let sum = 0;
    for (let k = 0; k <= c; k++) {
      const p = poissonPMF(k, lambda);
      probs[k] = p;
      sum += p;
    }

    if (sum > 0) {
      for (let k = 0; k <= c; k++) probs[k] /= sum;
    }

    let bestK = 0, bestP = probs[0];
    for (let k = 1; k <= c; k++) {
      if (probs[k] > bestP) {
        bestP = probs[k];
        bestK = k;
      }
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

  // -------------------------
  // MAIN: app.js calls this synchronously
  // -------------------------
  function predictMatchInternal(payload) {
    // required inputs
    const xgHome = Number(payload.xgHome ?? 1.35);
    const xgAway = Number(payload.xgAway ?? 1.35);

    // tuning knobs
    const leagueMult = Number(payload.leagueMult ?? 1.0);
    const homeAdv = Number(payload.homeAdv ?? 1.10);
    const goalCap = clamp(parseInt(payload.goalCap ?? 8, 10), 4, 12);

    // Goals lambdas
    let lamH = xgHome * leagueMult * homeAdv;
    let lamA = xgAway * leagueMult;

    lamH = clamp(lamH, 0.15, 3.75);
    lamA = clamp(lamA, 0.15, 3.75);

    const { grid } = buildScoreGrid(lamH, lamA, goalCap);

    // core
    const mostLikely = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    // packs
    const totals = buildTotalsPack(grid);
    const teamTotals = buildTeamTotalsPack(grid);
    const ah = buildAHPack(grid, goalCap); // quarter lines + DNB fair odds

    // cards/corners inputs (optional: you can pass from your data file)
    const cardsHome = Number(payload.cardsHome);
    const cardsAway = Number(payload.cardsAway);
    const cornersHome = Number(payload.cornersHome);
    const cornersAway = Number(payload.cornersAway);

    const haveCards = Number.isFinite(cardsHome) && Number.isFinite(cardsAway);
    const haveCorners = Number.isFinite(cornersHome) && Number.isFinite(cornersAway);

    // defaults if not provided
    const cardsTotalLam = haveCards ? clamp(cardsHome + cardsAway, 1.5, 10.0) : 4.6;
    const cornersTotalLam = haveCorners ? clamp(cornersHome + cornersAway, 4.0, 18.0) : 9.8;

    const cardsTotal = build1DTotal(cardsTotalLam, 20);
    const cornersTotal = build1DTotal(cornersTotalLam, 30);

    return {
      lamH,
      lamA,
      mostLikely,
      x12,
      ou25,
      btts,
      totals,
      teamTotals,
      ah,

      cards: {
        lambdaTotal: cardsTotalLam,
        mostLikelyTotal: cardsTotal.mostLikelyTotal,
        ou35: ou1D(cardsTotal, 3.5),
        ou45: ou1D(cardsTotal, 4.5),
        ou55: ou1D(cardsTotal, 5.5),
      },

      corners: {
        lambdaTotal: cornersTotalLam,
        mostLikelyTotal: cornersTotal.mostLikelyTotal,
        ou85: ou1D(cornersTotal, 8.5),
        ou95: ou1D(cornersTotal, 9.5),
        ou105: ou1D(cornersTotal, 10.5),
      },
    };
  }

  window.MQ = window.MQ || {};
  window.MQ.predictMatchInternal = predictMatchInternal;
})();
