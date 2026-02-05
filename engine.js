window.runPrediction = function ({
  league,
  home,
  away,
  sims,
  homeAdv,
  baseGoals,
  maxGoals,
  xgHome,
  xgAway
}) {

  // --- Monte Carlo ---
  let homeWins = 0, awayWins = 0, draws = 0;
  let totalGoals = 0;

  for (let i = 0; i < sims; i++) {
    const h = Math.min(
      maxGoals,
      Math.round(randomPoisson(xgHome * homeAdv))
    );
    const a = Math.min(
      maxGoals,
      Math.round(randomPoisson(xgAway))
    );

    totalGoals += h + a;

    if (h > a) homeWins++;
    else if (a > h) awayWins++;
    else draws++;
  }

  const homePct = (homeWins / sims) * 100;
  const drawPct = (draws / sims) * 100;
  const awayPct = (awayWins / sims) * 100;

  const avgGoals = totalGoals / sims;

  // --- Build output ---
  const output = `
    <div class="card">
      <h2>MatchQuant – Prediction</h2>

      <p><strong>${home} vs ${away}</strong> (${league})</p>

      <p><strong>xG λ</strong><br>
      ${home}: ${xgHome.toFixed(2)}<br>
      ${away}: ${xgAway.toFixed(2)}</p>

      <p><strong>Win Probabilities</strong><br>
      ${home}: ${homePct.toFixed(1)}%<br>
      Draw: ${drawPct.toFixed(1)}%<br>
      ${away}: ${awayPct.toFixed(1)}%</p>

      <p><strong>Markets</strong><br>
      O/U 2.5 Goals → ${avgGoals > 2.5 ? "Over" : "Under"}<br>
      Asian Handicap Lean → ${homePct > awayPct ? home : away}<br>
      Corners (avg): ${(avgGoals * 3.2).toFixed(1)}<br>
      Cards (avg): ${(avgGoals * 1.5).toFixed(1)}
      </p>
    </div>
  `;

  document.getElementById("outputCard").innerHTML = output;
};


// --- Poisson helper ---
function randomPoisson(lambda) {
  let L = Math.exp(-lambda);
  let p = 1.0;
  let k = 0;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
}
