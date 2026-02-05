/* MatchQuant engine.js — FULL REPLACEMENT (FINAL) */

window.runPrediction = function (p) {
  const {
    league, home, away,
    sims, homeAdv, baseGoals, capGoals,
    xg
  } = p;

  function teamXG(team) {
    if (xg[league] && xg[league][team] && xg[league][team].xGF) {
      return xg[league][team].xGF;
    }
    return baseGoals;
  }

  const hx = teamXG(home) * homeAdv;
  const ax = teamXG(away);

  let scoreCounts = {};
  let hw = 0, dr = 0, aw = 0;

  for (let i = 0; i < sims; i++) {
    const hg = Math.min(capGoals, Math.floor(Math.random() * (hx + 1.5)));
    const ag = Math.min(capGoals, Math.floor(Math.random() * (ax + 1.5)));
    const key = `${hg}-${ag}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;

    if (hg > ag) hw++;
    else if (hg < ag) aw++;
    else dr++;
  }

  const bestScore = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities:\n` +
    `${home}: ${(hw / sims * 100).toFixed(1)}%\n` +
    `Draw: ${(dr / sims * 100).toFixed(1)}%\n` +
    `${away}: ${(aw / sims * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${bestScore}\n\n` +
    `xG Model:\n${home}: ${hx.toFixed(2)}\n${away}: ${ax.toFixed(2)}`
  );
};
