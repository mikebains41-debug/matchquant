// engine.js — MatchQuant Engine (WORKING DROP-IN)
// ✅ Goals + 1X2 + O/U + BTTS + Team Totals + Asian Handicap (FULL: incl quarter lines) + Cards + Corners
// ✅ No "export" / no modules — works on GitHub Pages
// ✅ Exposes: window.MQ.predictMatchInternal(payload)
// ✅ Compatible with your app.js call style (sync)

// NOTE: Your app.js MUST pass cardsHome/cardsAway/cornersHome/cornersAway if you want those to be team-specific.
// If it doesn’t, engine will use sensible league defaults.

(() => {
  // -------------------------
  // Helpers
  // -------------------------
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

  function fairOddsFromProb(p) {
    if (!(p > 0)) return null;
    return +(1 / p).toFixed(2);
  }

  // -------------------------
  // Score grid (H goals x A goals)
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

    // Normalize because goalCap truncates tail mass
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
      homeOdds: fairOddsFromProb(home),
      drawOdds: fairOddsFromProb(draw),
      awayOdds: fairOddsFromProb(away),
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
    return { over, under, overOdds: fairOddsFromProb(over), underOdds: fairOddsFromProb(under) };
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
    return { yes, no, yesOdds: fairOddsFromProb(yes), noOdds: fairOddsFromProb(no) };
  }

  // -------------------------
  // Asian Handicap (FULL: integer/half/quarter)
  // We compute W/P/L for HOME and AWAY directly from the score grid.
  // "fairOdds" is DNB fair (push removed): 1 / (win/(win+lose))
  // -------------------------
  function buildDiffDistribution(scoreProb, maxGoals) {
    const MG = maxGoals;
    const offset = MG;
    const diffProb = Array(2 * MG + 1).fill(0);

    for (let h = 0; h <= MG; h++) {
      const row = scoreProb[h] || {};
      for (let a = 0; a <= MG; a++) {
        const p = Number(row[a] ?? 0);
        if (!p) continue;
        const d = h - a;
        if (d < -MG || d > MG) continue;
        diffProb[d + offset] += p;
      }
    }

    // Prefix sums for fast queries
    const pref = Array(diffProb.length + 1).fill(0);
    for (let i = 0; i < diffProb.length; i++) pref[i + 1] = pref[i] + diffProb[i];

    const sumIdx = (i0, i1) => {
      i0 = Math.max(0, Math.min(diffProb.length - 1, i0 | 0));
      i1 = Math.max(0, Math.min(diffProb.length - 1, i1 | 0));
      if (i1 < i0) return 0;
      return pref[i1 + 1] - pref[i0];
    };

    const P_ge = (x) => sumIdx(x + offset, MG + offset);
    const P_gt = (x) => P_ge(x + 1);
    const P_le = (x) => sumIdx(-MG + offset, x + offset);
    const P_lt = (x) => P_le(x - 1);
    const P_eq = (x) => diffProb[x + offset] ?? 0;

    return { P_ge, P_gt, P_le, P_lt, P_eq };
  }

  function isQuarterOnly(line) {
    const q = Math.round(line * 4);
    const isQuarterStep = Math.abs(line * 4 - q) < 1e-12;
    const isHalfStep = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12;
    return isQuarterStep && !isHalfStep;
  }

  function evalHalfOrIntFromDiff(dist, line) {
    // line must be integer or half
    const isInteger = Math.abs(line - Math.round(line)) < 1e-12;
    const isHalf = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12 && !isInteger;
    if (!isInteger && !isHalf) throw new Error("line must be integer or half");

    // Bet condition for HOME at line L:
    // win if diff + L > 0
    // push if diff + L == 0  (only possible for integer L)
    // lose if diff + L < 0
    if (isInteger) {
      const t = -Math.round(line); // push at diff == t
      const win = dist.P_gt(t);
      const push = dist.P_eq(t);
      const lose = dist.P_lt(t);
      return { win, push, lose };
    }

    // half line: no push possible (diff integer, threshold x.5)
    const t = -line;                 // x.5
    const smallestWin = Math.floor(t) + 1; // first integer > t
    const largestLose = Math.floor(t);     // last integer < t
    const win = dist.P_ge(smallestWin);
    const push = 0;
    const lose = dist.P_le(largestLose);
    return { win, push, lose };
  }

  function evalAsianLineHome(dist, line) {
    if (!isQuarterOnly(line)) return evalHalfOrIntFromDiff(dist, line);

    // quarter: split stake into adjacent half lines
    const lower = Math.floor(line * 2) / 2;
    const upper = lower + 0.5;

    const a = evalHalfOrIntFromDiff(dist, lower);
    const b = evalHalfOrIntFromDiff(dist, upper);

    return {
      win: 0.5 * (a.win + b.win),
      push: 0.5 * (a.push + b.push),
      lose: 0.5 * (a.lose + b.lose),
    };
  }

  function toDnbFair(wpl) {
    const win = wpl.win, push = wpl.push, lose = wpl.lose;
    const denom = win + lose;
    const dnbWinProb = denom > 0 ? win / denom : 0;
    const fairOdds = dnbWinProb > 0 ? +(1 / dnbWinProb).toFixed(2) : null;
    return { win, push, lose, dnbWinProb, fairOdds };
  }

  function buildAHPack(grid, goalCap = 8) {
    const cap = clamp(parseInt(goalCap || 8, 10), 4, 12);
    const dist = buildDiffDistribution(grid, cap);

    const lines = [
      -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25,
       0,  0.25,  0.5,  0.75,  1,  1.25,  1.5,  1.75, 2
    ];

    const out = { home: {}, away: {} };

    for (const L of lines) {
      // HOME at line L
      const homeWPL = evalAsianLineHome(dist, L);
      const home = toDnbFair(homeWPL);

      // AWAY at line L is same as HOME at line (-L) but with win/lose swapped on the *bet result*
      // Easiest correct way:
      // Compute HOME WPL at (-L), then map to AWAY WPL at (L):
      const homeAtNeg = evalAsianLineHome(dist, -L);
      const awayWPL = { win: homeAtNeg.lose, push: homeAtNeg.push, lose: homeAtNeg.win };
      const away = toDnbFair(awayWPL);

      out.home[String(L)] = {
        win: +home.win.toFixed(6),
        push: +home.push.toFixed(6),
        lose: +home.lose.toFixed(6),
        dnbWinProb: +home.dnbWinProb.toFixed(6),
        fairOdds: home.fairOdds,
      };

      out.away[String(L)] = {
        win: +away.win.toFixed(6),
        push: +away.push.toFixed(6),
        lose: +away.lose.toFixed(6),
        dnbWinProb: +away.dnbWinProb.toFixed(6),
        fairOdds: away.fairOdds,
      };
    }

    return out;
  }

  // -------------------------
  // Totals packs
  // -------------------------
  function buildTotalsPack(grid) {
    const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
    const out = {};
    lines.forEach((ln) => (out[String(ln)] = calcOverUnder(grid, ln)));
    return out;
  }

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
    return { over, under, overOdds: fairOddsFromProb(over), underOdds: fairOddsFromProb(under) };
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
  // Cards/Corners total models (1D Poisson)
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
    return { over, under, overOdds: fairOddsFromProb(over), underOdds: fairOddsFromProb(under) };
  }

  // -------------------------
  // MAIN entry (SYNC)
  // -------------------------
  function predictMatchInternal(payload) {
    // Inputs from app.js
    const xgHome = Number(payload.xgHome ?? 1.35);
    const xgAway = Number(payload.xgAway ?? 1.35);

    const leagueMult = Number(payload.leagueMult ?? 1.0);
    const homeAdv = Number(payload.homeAdv ?? 1.10);
    const goalCap = clamp(parseInt(payload.goalCap ?? 8, 10), 4, 12);

    // Lambdas
    let lamH = xgHome * leagueMult * homeAdv;
    let lamA = xgAway * leagueMult;

    lamH = clamp(lamH, 0.15, 3.75);
    lamA = clamp(lamA, 0.15, 3.75);

    const { grid } = buildScoreGrid(lamH, lamA, goalCap);

    const mostLikely = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);

    const totals = buildTotalsPack(grid);
    const teamTotals = buildTeamTotalsPack(grid);
    const ah = buildAHPack(grid, goalCap);

    // Cards/Corners: if app.js passes cardsHome/cardsAway etc, we use them.
    const cardsHome = Number(payload.cardsHome);
    const cardsAway = Number(payload.cardsAway);
    const cornersHome = Number(payload.cornersHome);
    const cornersAway = Number(payload.cornersAway);

    const haveCards = Number.isFinite(cardsHome) && Number.isFinite(cardsAway);
    const haveCorners = Number.isFinite(cornersHome) && Number.isFinite(cornersAway);

    // Defaults if not provided (league-ish typical)
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
