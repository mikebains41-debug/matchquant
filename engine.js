/* MatchQuant Engine — Pro Monte Carlo Core
   Defines: window.runPrediction(params)
*/

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

function monteCarloMatch(home, away, sims, settings) {
  const {
    homeAdv,
    baseGoals,
    capGoals
  } = settings;

  const lambdaHome = Math.min(
    baseGoals * home.att * away.def * homeAdv,
    capGoals
  );
  const lambdaAway = Math.min(
    baseGoals * away.att * home.def,
    capGoals
  );

  let results = {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    goals: [],
    corners: [],
    cards: []
  };

  for (let i = 0; i < sims; i++) {
    const hg = poisson(lambdaHome);
    const ag = poisson(lambdaAway);

    if (hg > ag) results.homeWins++;
    else if (hg === ag) results.draws++;
    else results.awayWins++;

    results.goals.push(hg + ag);
    results.corners.push(
      Math.round(8 + Math.random() * 6)
    );
    results.cards.push(
      Math.round(3 + Math.random() * 4)
    );
  }

  return {
    lambdaHome,
    lambdaAway,
    homeWinPct: results.homeWins / sims,
    drawPct: results.draws / sims,
    awayWinPct: results.awayWins / sims,
    avgGoals: avg(results.goals),
    avgCorners: avg(results.corners),
    avgCards: avg(results.cards)
  };
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function gradeConfidence(homeWin, draw, awayWin) {
  const max = Math.max(homeWin, draw, awayWin);
  if (max > 0.62) return "A";
  if (max > 0.52) return "B";
  return "C";
}

/* 🔑 REQUIRED GLOBAL FUNCTION */
window.runPrediction = function (params) {
  const {
    league,
    home,
    away,
    sims,
    homeAdv,
    baseGoals,
    capGoals,
    xgRaw
  } = params;

  // Locate teams in xG tables
  const leagueData =
    xgRaw[league] ||
    (xgRaw.leagues ? xgRaw.leagues[league] : null);

  if (!leagueData) {
    alert("League not found in xG tables");
    return;
  }

  const homeTeam = leagueData[home];
  const awayTeam = leagueData[away];

  if (!homeTeam || !awayTeam) {
    alert("Team data missing in xG tables");
    return;
  }

  const result = monteCarloMatch(
    homeTeam,
    awayTeam,
    sims,
    { homeAdv, baseGoals, capGoals }
  );

  const grade = gradeConfidence(
    result.homeWinPct,
    result.drawPct,
    result.awayWinPct
  );

  const output = `
${home} vs ${away} (${league})

xG λ:
${home}: ${result.lambdaHome.toFixed(2)}
${away}: ${result.lambdaAway.toFixed(2)}

Win Probabilities:
${home}: ${(result.homeWinPct * 100).toFixed(1)}%
Draw: ${(result.drawPct * 100).toFixed(1)}%
${away}: ${(result.awayWinPct * 100).toFixed(1)}%

Markets:
O/U 2.5 Goals → ${(result.avgGoals > 2.5 ? "Over" : "Under")}
Asian Handicap Lean → ${homeWin(result) ? home : away}
Corners (avg): ${result.avgCorners.toFixed(1)}
Cards (avg): ${result.avgCards.toFixed(1)}

Pro Confidence: ${grade}
`;

  alert(output);
};

function homeWin(r) {
  return r.homeWinPct >= r.awayWinPct;
}
