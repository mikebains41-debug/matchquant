// ===============================
// MatchQuant Prediction Engine
// ===============================

(function () {
  function poisson(lambda) {
    let L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  function simulateMatch(homeXg, awayXg, sims, cap) {
    let homeWins = 0,
      awayWins = 0,
      draws = 0;

    let scoreCounts = {};

    for (let i = 0; i < sims; i++) {
      let h = Math.min(poisson(homeXg), cap);
      let a = Math.min(poisson(awayXg), cap);

      const key = `${h}-${a}`;
      scoreCounts[key] = (scoreCounts[key] || 0) + 1;

      if (h > a) homeWins++;
      else if (a > h) awayWins++;
      else draws++;
    }

    let bestScore = Object.entries(scoreCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    return {
      homeWin: (homeWins / sims) * 100,
      draw: (draws / sims) * 100,
      awayWin: (awayWins / sims) * 100,
      bestScore,
    };
  }

  window.runPrediction = function (params) {
    const {
      league,
      home,
      away,
      sims,
      baseGoals,
      homeAdv,
      capGoals
