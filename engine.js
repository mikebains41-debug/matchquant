/* MatchQuant Engine v2 — FULL REPLACEMENT
   Proper xG-driven Monte Carlo engine
*/

(function () {
  function poisson(lambda) {
    let L = Math.exp(-lambda);
    let p = 1;
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

  function getTeamXG(xgRaw, league, team) {
    if (!xgRaw) return null;

    const root = xgRaw.leagues || xgRaw.data || xgRaw;

    // array rows
    if (Array.isArray(root)) {
      const row = root.find(
        r =>
          (r.league === league || r.competition === league) &&
          (r.team === team || r.squad === team)
      );
      return row || null;
    }

    // object map
    if (root[league] && root[league][team]) {
      return root[league][team];
    }

    return null;
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
      xgRaw
    } = params;

    if (!league || !home || !away) {
      alert("MatchQuant says\n\nMissing league or teams.");
      return;
    }

    const homeXG = getTeamXG(xgRaw, league, home);
    const awayXG = getTeamXG(xgRaw, league, away);

    if (!homeXG || !awayXG) {
      alert(
        "MatchQuant says\n\nxG data missing for one or both teams.\nUsing league averages."
      );
    }

    const h_for = homeXG?.xGF || homeXG?.xg_for || baseGoals;
    const h_against = homeXG?.xGA || homeXG?.xg_against || baseGoals;

    const a_for = awayXG?.xGF || awayXG?.xg_for || baseGoals;
    const a_against = awayXG?.xGA || awayXG?.xg_against || baseGoals;

    // expected goals
    let lambdaHome = ((h_for + a_against) / 2) * homeAdv;
    let lambdaAway = (a_for + h_against) / 2;

    lambdaHome = clamp(lambdaHome, 0.2, capGoals);
    lambdaAway = clamp(lambdaAway, 0.2, capGoals);

    let results = {};
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;

    for (let i = 0; i < sims; i++) {
      const hg = clamp(poisson(lambdaHome), 0, capGoals);
      const ag = clamp(poisson(lambdaAway), 0, capGoals);

      const key = `${hg}-${ag}`;
      results[key] = (results[key] || 0) + 1;

      if (hg > ag) homeWins++;
      else if (hg < ag) awayWins++;
      else draws++;
    }

    let topScore = "1-1";
    let topCount = 0;

    for (const k in results) {
      if (results[k] > topCount) {
        topCount = results[k];
        topScore = k;
      }
    }

    const hw = ((homeWins / sims) * 100).toFixed(1);
    const dr = ((draws / sims) * 100).toFixed(1);
    const aw = ((awayWins / sims) * 100).toFixed(1);

    alert(
      `MatchQuant says\n\n` +
        `${home} vs ${away}\n\n` +
        `Win Probabilities:\n` +
        `${home}: ${hw}%\n` +
        `Draw: ${dr}%\n` +
        `${away}: ${aw}%\n\n` +
        `Most Likely Score: ${topScore}\n\n` +
        `xG Model:\n` +
        `${home}: ${lambdaHome.toFixed(2)}\n` +
        `${away}: ${lambdaAway.toFixed(2)}`
    );
  };
})();
