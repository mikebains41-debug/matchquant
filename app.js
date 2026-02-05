// ===============================
// MatchQuant – AI Score Engine
// ===============================

// League averages (current season – EPL example)
const LEAGUE_AVG_GOALS = 1.45;

// Load league table CSV
async function loadLeagueData() {
  const res = await fetch("league-chemp.csv");
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1);

  const teams = {};
  rows.forEach(r => {
    const c = r.replace(/"/g, "").split(";");
    teams[c[1]] = {
      gf: parseFloat(c[6]) / parseInt(c[2]),
      ga: parseFloat(c[7]) / parseInt(c[2])
    };
  });
  return teams;
}

// Poisson sampler
function poisson(lambda) {
  let L = Math.exp(-lambda);
  let p = 1, k = 0;
  while (p > L) {
    k++;
    p *= Math.random();
  }
  return k - 1;
}

// MAIN PREDICTION ENGINE
async function runPrediction() {
  const home = document.getElementById("homeTeam").value;
  const away = document.getElementById("awayTeam").value;
  const sims = parseInt(document.getElementById("sims").value);

  const data = await loadLeagueData();

  if (!data[home] || !data[away]) {
    alert("Team data missing");
    return;
  }

  // AI-style xG calculation
  const homeAttack = data[home].gf / LEAGUE_AVG_GOALS;
  const awayDefence = data[away].ga / LEAGUE_AVG_GOALS;
  const awayAttack = data[away].gf / LEAGUE_AVG_GOALS;
  const homeDefence = data[home].ga / LEAGUE_AVG_GOALS;

  const lambdaHome = LEAGUE_AVG_GOALS * homeAttack * awayDefence * 1.08;
  const lambdaAway = LEAGUE_AVG_GOALS * awayAttack * homeDefence;

  let scoreCount = {};
  let homeWins = 0, draws = 0, awayWins = 0;
  let goalsH = 0, goalsA = 0;

  for (let i = 0; i < sims; i++) {
    const h = poisson(lambdaHome);
    const a = poisson(lambdaAway);

    goalsH += h;
    goalsA += a;

    const key = `${h}-${a}`;
    scoreCount[key] = (scoreCount[key] || 0) + 1;

    if (h > a) homeWins++;
    else if (h === a) draws++;
    else awayWins++;
  }

  const bestScore = Object.entries(scoreCount)
    .sort((a, b) => b[1] - a[1])[0][0];

  document.getElementById("output").innerHTML = `
    <div class="mono">
      <b>${home} vs ${away}</b><br><br>
      λ Home: ${lambdaHome.toFixed(2)} | λ Away: ${lambdaAway.toFixed(2)}<br>
      Avg goals: ${(goalsH/sims).toFixed(2)} - ${(goalsA/sims).toFixed(2)}<br>
      <b>Most likely score: ${bestScore}</b><br><br>
      1X2:
      Home ${(homeWins/sims*100).toFixed(1)}% |
      Draw ${(draws/sims*100).toFixed(1)}% |
      Away ${(awayWins/sims*100).toFixed(1)}%
    </div>
  `;
}

window.runPrediction = runPrediction;
