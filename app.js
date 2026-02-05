// MatchQuant Engine v2 — FIXED MODEL (put this in app.js)

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

function simulateMatch(home, away, league, sims = 10000, homeAdv = 1.1) {
  const baseGoals = 1.35;

  // λ goals (FIXED)
  const lambdaHome = baseGoals * home.att * away.def * homeAdv;
  const lambdaAway = baseGoals * away.att * home.def;

  let scoreMap = {};
  let h = 0, d = 0, a = 0;
  let over25 = 0, over35 = 0, btts = 0;

  for (let i = 0; i < sims; i++) {
    const hg = poisson(lambdaHome);
    const ag = poisson(lambdaAway);
    const key = `${hg}-${ag}`;
    scoreMap[key] = (scoreMap[key] || 0) + 1;

    if (hg > ag) h++;
    else if (hg === ag) d++;
    else a++;

    if (hg + ag > 2.5) over25++;
    if (hg + ag > 3.5) over35++;
    if (hg > 0 && ag > 0) btts++;
  }

  const mostLikelyScore = Object.entries(scoreMap).sort((x, y) => y[1] - x[1])[0][0];

  return {
    score: mostLikelyScore,
    probs: {
      H: +(h / sims * 100).toFixed(1),
      D: +(d / sims * 100).toFixed(1),
      A: +(a / sims * 100).toFixed(1),
    },
    totals: {
      over25: +(over25 / sims * 100).toFixed(1),
      over35: +(over35 / sims * 100).toFixed(1),
      btts: +(btts / sims * 100).toFixed(1),
    },
    ah: lambdaHome - lambdaAway,
    corners: +(8.5 + (lambdaHome + lambdaAway)).toFixed(2),
    cards: +(3.6 + Math.abs(lambdaHome - lambdaAway)).toFixed(2),
    confidence:
      Math.max(h, d, a) / sims > 0.6 ? "A" :
      Math.max(h, d, a) / sims > 0.5 ? "B" : "C"
  };
}
