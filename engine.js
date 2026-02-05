/* MatchQuant engine.js — FULL REPLACEMENT */

window.runPrediction = function (p) {
  const { league, home, away, sims, homeAdv, baseGoals, capGoals, xg } = p;

  function getXG(team) {
    if (xg[league] && xg[league][team]) {
      return xg[league][team].xGF || baseGoals;
    }
    return baseGoals;
  }

  const hx = getXG(home) * homeAdv;
  const ax = getXG(away);

  let results = {};
  let homeWins = 0, draws = 0, awayWins = 0;

  for (let i = 0; i < sims; i++) {
    const hg = Math.min(capGoals, Math.floor(Math.random() * (hx + 2)));
    const ag = Math.min(capGoals, Math.floor(Math.random() * (ax + 2)));
    const k = `${hg}-${ag}`;
    results[k] = (results[k] || 0) + 1;

    if (hg > ag) homeWins++;
    else if (hg < ag) awayWins++;
    else draws++;
  }

  const best = Object.entries(results).sort((a, b) => b[1] - a[1])[0][0];

  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities:\n` +
    `${home}: ${(homeWins / sims * 100).toFixed(1)}%\n` +
    `Draw: ${(draws / sims * 100).toFixed(1)}%\n` +
    `${away}: ${(awayWins / sims * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${best}\n\n` +
    `xG Model:\n${home}: ${hx.toFixed(2)}\n${away}: ${ax.toFixed(2)}`
  );
};
