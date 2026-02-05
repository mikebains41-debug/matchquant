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

  window.runPrediction = function (params) {
    const {
      home,
      away,
      sims,
      homeAdv,
      baseGoals
    } = params;

    const homeLambda = baseGoals * homeAdv;
    const awayLambda = baseGoals;

    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let scores = {};

    for (let i = 0; i < sims; i++) {
      const h = poisson(homeLambda);
      const a = poisson(awayLambda);
      const key = `${h}-${a}`;
      scores[key] = (scores[key] || 0) + 1;

      if (h > a) homeWins++;
      else if (a > h) awayWins++;
      else draws++;
    }

    const mostLikely = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0][0];

    alert(
      `${home} vs ${away}\n\n` +
      `Win Probabilities:\n` +
      `${home}: ${(homeWins / sims * 100).toFixed(1)}%\n` +
      `Draw: ${(draws / sims * 100).toFixed(1)}%\n` +
      `${away}: ${(awayWins / sims * 100).toFixed(1)}%\n\n` +
      `Most Likely Score: ${mostLikely}`
    );
  };

})();
