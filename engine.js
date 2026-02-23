window.MQ2 = (function () {

  // ---------- helpers ----------
  function safe(n, d = 0) {
    return (typeof n === "number" && Number.isFinite(n)) ? n : d;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Works if xgTables[league] is:
  //  A) array of rows [{team, matches, xG, xGA, ...}]
  //  B) map of teams { "Arsenal": {matches,xG,xGA,...}, ... }
  function getTeamRow(xgTables, league, team) {
    const L = xgTables?.[league];
    if (!L) return null;

    if (Array.isArray(L)) {
      return L.find(r => r && r.team === team) || null;
    }

    // map form
    const row = L?.[team];
    if (!row) return null;
    return { team, ...row };
  }

  // splits can be:
  //  A) {home:[{team,...}], away:[{team,...}]}
  //  B) {home:{team:row}, away:{team:row}}
  function getSplitRow(splitsByLeague, league, side /*home|away*/, team) {
    const L = splitsByLeague?.[league];
    if (!L) return null;

    const S = L?.[side];
    if (!S) return null;

    if (Array.isArray(S)) {
      return S.find(r => r && r.team === team) || null;
    }
    return S?.[team] || null;
  }

  // Poisson PMF computed iteratively for stability
  function poissonPmf(lambda, maxK) {
    const pmf = new Array(maxK + 1).fill(0);
    if (!(lambda >= 0)) return pmf;

    const L = Math.exp(-lambda);
    pmf[0] = L;

    // pmf[k] = pmf[k-1] * lambda / k
    for (let k = 1; k <= maxK; k++) {
      pmf[k] = pmf[k - 1] * lambda / k;
    }

    // Any remaining mass beyond maxK is ignored; keep maxK high enough.
    return pmf;
  }

  function buildScoreMatrix(lamH, lamA, maxGoals = 10) {
    const pH = poissonPmf(lamH, maxGoals);
    const pA = poissonPmf(lamA, maxGoals);

    // matrix[h][a] = P(H=h, A=a)
    const matrix = [];
    for (let h = 0; h <= maxGoals; h++) {
      const row = [];
      for (let a = 0; a <= maxGoals; a++) {
        row.push(pH[h] * pA[a]);
      }
      matrix.push(row);
    }
    return matrix;
  }

  function summarize1X2(matrix) {
    let pHome = 0, pDraw = 0, pAway = 0;
    const maxH = matrix.length - 1;
    const maxA = matrix[0].length - 1;

    for (let h = 0; h <= maxH; h++) {
      for (let a = 0; a <= maxA; a++) {
        const p = matrix[h][a];
        if (h > a) pHome += p;
        else if (h === a) pDraw += p;
        else pAway += p;
      }
    }
    return { pHome, pDraw, pAway };
  }

  function bestScore(matrix) {
    let best = { h: 0, a: 0, p: 0 };
    const maxH = matrix.length - 1;
    const maxA = matrix[0].length - 1;

    for (let h = 0; h <= maxH; h++) {
      for (let a = 0; a <= maxA; a++) {
        const p = matrix[h][a];
        if (p > best.p) best = { h, a, p };
      }
    }
    return best;
  }

  function expTotalFromMatrix(matrix) {
    let e = 0;
    const maxH = matrix.length - 1;
    const maxA = matrix[0].length - 1;

    for (let h = 0; h <= maxH; h++) {
      for (let a = 0; a <= maxA; a++) {
        e += (h + a) * matrix[h][a];
      }
    }
    return e;
  }

  // Profit-weighted evaluation helper:
  // Win => 1, Push => 0.5, Loss => 0
  function settleValue(result /*diff + line*/) {
    if (result > 0) return 1;
    if (result === 0) return 0.5;
    return 0;
  }

  // Split quarter lines into two half-stakes:
  // ex: +0.25 => [+0.0, +0.5], +0.75 => [+0.5, +1.0]
  //     -0.25 => [-0.0, -0.5], -0.75 => [-0.5, -1.0]
  function splitAsianLine(line) {
    const frac = Math.abs(line % 1);
    const s = Math.sign(line) || 1;

    // normalize annoying floating stuff
    const f = Math.round(frac * 100) / 100;

    if (f === 0.25) return [line - 0.25 * s, line + 0.25 * s];
    if (f === 0.75) return [line - 0.25 * s, line + 0.25 * s];
    return [line];
  }

  function asianHandicapProb(matrix, homeLine) {
    // homeLine is the handicap applied to HOME goals (home covers if (h - a + line) > 0)
    const lines = splitAsianLine(homeLine);
    const maxH = matrix.length - 1;
    const maxA = matrix[0].length - 1;

    let totalVal = 0;
    for (const L of lines) {
      let v = 0;
      for (let h = 0; h <= maxH; h++) {
        for (let a = 0; a <= maxA; a++) {
          const p = matrix[h][a];
          const diff = h - a;
          v += p * settleValue(diff + L);
        }
      }
      totalVal += v;
    }
    return totalVal / lines.length;
  }

  function asianTotalProb(matrix, line, isOver) {
    // Over: total - line > 0 ; Under: line - total > 0 (same settle logic)
    const lines = splitAsianLine(line);
    const maxH = matrix.length - 1;
    const maxA = matrix[0].length - 1;

    let totalVal = 0;
    for (const L of lines) {
      let v = 0;
      for (let h = 0; h <= maxH; h++) {
        for (let a = 0; a <= maxA; a++) {
          const p = matrix[h][a];
          const tot = h + a;
          const res = isOver ? (tot - L) : (L - tot);
          v += p * settleValue(res);
        }
      }
      totalVal += v;
    }
    return totalVal / lines.length;
  }

  function fairOddsFromProb(p) {
    if (!(p > 0)) return null;
    return 1 / p;
  }

  function noVigFromOdds(oddsH, oddsD, oddsA) {
    const iH = oddsH ? 1 / oddsH : null;
    const iD = oddsD ? 1 / oddsD : null;
    const iA = oddsA ? 1 / oddsA : null;

    if (!(iH > 0) || !(iD > 0) || !(iA > 0)) return null;

    const s = iH + iD + iA;
    return { pH: iH / s, pD: iD / s, pA: iA / s };
  }

  // ---------- model ----------
  function computeLambda({ league, homeTeam, awayTeam, tables }) {
    const seasonHome = getTeamRow(tables.xg, league, homeTeam);
    const seasonAway = getTeamRow(tables.xg, league, awayTeam);

    // fallback if missing
    if (!seasonHome || !seasonAway) {
      return { lamH: 1.35, lamA: 1.10, pace: 1.0 };
    }

    // try splits
    const homeSplit = getSplitRow(tables.splits, league, "home", homeTeam);
    const awaySplit = getSplitRow(tables.splits, league, "away", awayTeam);

    const homeMatches = safe(homeSplit?.matches, safe(seasonHome.matches, 0));
    const awayMatches = safe(awaySplit?.matches, safe(seasonAway.matches, 0));

    const home_xG = (homeSplit && homeMatches > 0)
      ? safe(homeSplit.xG) / homeMatches
      : (safe(seasonHome.xG) / safe(seasonHome.matches, 1));

    const home_xGA = (homeSplit && homeMatches > 0)
      ? safe(homeSplit.xGA) / homeMatches
      : (safe(seasonHome.xGA) / safe(seasonHome.matches, 1));

    const away_xG = (awaySplit && awayMatches > 0)
      ? safe(awaySplit.xG) / awayMatches
      : (safe(seasonAway.xG) / safe(seasonAway.matches, 1));

    const away_xGA = (awaySplit && awayMatches > 0)
      ? safe(awaySplit.xGA) / awayMatches
      : (safe(seasonAway.xGA) / safe(seasonAway.matches, 1));

    // core blend: home attack vs away defense, away attack vs home defense
    let lamH = (home_xG + away_xGA) / 2;
    let lamA = (away_xG + home_xGA) / 2;

    // clamp to sane range
    lamH = clamp(lamH, 0.2, 4.5);
    lamA = clamp(lamA, 0.2, 4.5);

    return { lamH, lamA, pace: 1.0 };
  }

  function analyzeMatch({ league, homeTeam, awayTeam, tables, options }) {
    if (!league || !homeTeam || !awayTeam) {
      return { error: "Select league + home + away." };
    }

    const { lamH, lamA, pace } = computeLambda({ league, homeTeam, awayTeam, tables });

    // exact Poisson grid (gold standard for this kind of quick model)
    const maxGoals = 10;
    const matrix = buildScoreMatrix(lamH, lamA, maxGoals);

    const { pHome, pDraw, pAway } = summarize1X2(matrix);
    const best = bestScore(matrix);
    const expTotal = expTotalFromMatrix(matrix);

    // optional markets
    const ouLine = (options && Number.isFinite(options.ouLine)) ? options.ouLine : null;
    const ahLine = (options && Number.isFinite(options.ahLine)) ? options.ahLine : null;

    const pOver = (ouLine != null) ? asianTotalProb(matrix, ouLine, true) : null;
    const pUnder = (ouLine != null) ? asianTotalProb(matrix, ouLine, false) : null;

    const pAHHome = (ahLine != null) ? asianHandicapProb(matrix, ahLine) : null;
    const pAHAway = (ahLine != null) ? asianHandicapProb(matrix, -ahLine) : null;

    // fair odds
    const fairOdds = {
      home: fairOddsFromProb(pHome),
      draw: fairOddsFromProb(pDraw),
      away: fairOddsFromProb(pAway),
      over: (pOver != null) ? fairOddsFromProb(pOver) : null,
      under: (pUnder != null) ? fairOddsFromProb(pUnder) : null
    };

    // market comparison (no-vig from user odds)
    const mv = noVigFromOdds(options?.oddsH, options?.oddsD, options?.oddsA);
    const market = mv ? { noVig: { pH: mv.pH, pD: mv.pD, pA: mv.pA } } : null;

    const edges = mv ? {
      home: pHome - mv.pH,
      draw: pDraw - mv.pD,
      away: pAway - mv.pA
    } : null;

    return {
      inputs: {
        league,
        homeTeam,
        awayTeam,
        lamH,
        lamA,
        pace
      },
      model: {
        expHome: lamH,
        expAway: lamA,
        expTotal,
        pHome,
        pDraw,
        pAway,
        bestScore: best,
        pOver,
        pUnder,
        pAHHome,
        pAHAway
      },
      market,
      edges,
      fairOdds
    };
  }

  return { analyzeMatch };

})();
