/* MatchQuant engine.js
   - Defines window.runPrediction(params)
   - Uses Poisson + Monte Carlo
   - Safe defaults (no crashes)
*/

(function () {
  function poisson(lambda) {
    let L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  window.runPrediction = function (params) {
    const {
      league,
      home,
      away,
      sims = 10000,
      homeAdv = 1.1,
      baseGoals = 1.35,
      capGoals = 8,
      xgRaw,
      h2hRaw,
    } = params || {};

    if (!league || !home || !away) {
      throw new Error("Missing league / home / away");
    }

    // ---- Extract xG safely ----
    let homeXg = baseGoals;
    let awayXg = baseGoals;

    try {
      const root = xgRaw?.leagues || xgRaw?.data || xgRaw || {};
      const lg = root[league] || {};

      const hRow = lg[home];
      const aRow = lg[away];

      if (hRow) homeXg = Number(hRow.xg || hRow.xGF || baseGoals);
      if (aRow) awayXg = Number(aRow.xg || aRow.xGF || baseGoals);
    } catch (e) {
      console.warn("xG fallback used");
    }

    // Apply home advantage
    homeXg *= homeAdv;

    // ---- Monte Carlo ----
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let totalGoals = 0;

    for (let i = 0; i < sims; i++) {
      const hg = clamp(poisson(homeXg), 0, capGoals);
      const ag = clamp(poisson(awayXg), 0, capGoals);

      totalGoals += hg + ag;

      if (hg > ag) homeWins++;
      else if (ag > hg) awayWins++;
      else draws++;
    }

    const result = {
      fixture: `${home} vs ${away} (${league})`,
      xg: {
        home: homeXg.toFixed(2),
        away: awayXg.toFixed(2),
      },
      probabilities: {
        home: ((homeWins / sims) * 100).toFixed(1),
        draw: ((draws / sims) * 100).toFixed(1),
        away: ((awayWins / sims) * 100).toFixed(1),
      },
      markets: {
        over25: totalGoals / sims > 2.5 ? "Over" : "Under",
        asianLean: homeWins > awayWins ? home : away,
      },
    };

    // ---- OUTPUT (NO browser alert branding later) ----
    alert(
      `MatchQuant says:\n\n` +
        `${result.fixture}\n\n` +
        `xG:\n${home}: ${result.xg.home}\n${away}: ${result.xg.away}\n\n` +
        `Win %:\n${home}: ${result.probabilities.home}%\nDraw: ${result.probabilities.draw}%\n${away}: ${result.probabilities.away}%\n\n` +
        `Markets:\nO/U 2.5 → ${result.markets.over25}\nAsian Lean → ${result.markets.asianLean}`
    );

    return result;
  };
})();
