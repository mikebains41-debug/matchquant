/* MatchQuant engine.js
   Exposes: window.runPrediction(params) -> returns result object
   Does NOT use alert() (app.js shows custom modal)
*/
(function () {
  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let p = 1, k = 0;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickXgNumber(row, fallback) {
    if (!row) return fallback;
    const candidates = [row.xg, row.xGF, row.for, row.attack, row.xG, row.xg_for];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
  }

  window.runPrediction = function (params) {
    const {
      league, home, away,
      sims = 10000,
      homeAdv = 1.10,
      baseGoals = 1.35,
      capGoals = 8,
      xgRaw,
    } = params || {};

    if (!league || !home || !away) throw new Error("Pick league + home + away");

    // xG lookup (supports many shapes)
    let homeXg = baseGoals;
    let awayXg = baseGoals;

    try {
      const root = xgRaw?.leagues || xgRaw?.data || xgRaw || {};
      const lg = root[league] || root[league?.toLowerCase?.()] || {};
      const hRow = lg[home] || lg[home?.toLowerCase?.()] || null;
      const aRow = lg[away] || lg[away?.toLowerCase?.()] || null;

      homeXg = pickXgNumber(hRow, baseGoals);
      awayXg = pickXgNumber(aRow, baseGoals);
    } catch {
      // keep fallbacks
    }

    homeXg *= Number(homeAdv) || 1.10;

    const N = clamp(Number(sims) || 10000, 500, 250000);
    const cap = clamp(Number(capGoals) || 8, 5, 12);

    let homeWins = 0, awayWins = 0, draws = 0;
    let totalGoals = 0;

    // scoreline counts for most common score
    const scoreCount = new Map();

    for (let i = 0; i < N; i++) {
      const hg = clamp(poisson(homeXg), 0, cap);
      const ag = clamp(poisson(awayXg), 0, cap);

      totalGoals += hg + ag;

      const key = `${hg}-${ag}`;
      scoreCount.set(key, (scoreCount.get(key) || 0) + 1);

      if (hg > ag) homeWins++;
      else if (ag > hg) awayWins++;
      else draws++;
    }

    // most common score
    let bestScore = "—";
    let bestC = -1;
    for (const [k, c] of scoreCount.entries()) {
      if (c > bestC) { bestC = c; bestScore = k; }
    }

    const pHome = (homeWins / N) * 100;
    const pDraw = (draws / N) * 100;
    const pAway = (awayWins / N) * 100;

    return {
      fixture: `${home} vs ${away} (${league})`,
      xg: { home: homeXg, away: awayXg },
      probs: { home: pHome, draw: pDraw, away: pAway },
      markets: {
        ou25: (totalGoals / N) > 2.5 ? "Over" : "Under",
        asianLean: homeWins >= awayWins ? home : away
      },
      mostLikelyScore: bestScore
    };
  };
})();
