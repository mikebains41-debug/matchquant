let xgData = {};
let fixtures = [];

fetch("xg_tables.json")
  .then(r => r.json())
  .then(data => {
    xgData = data;
    populateLeagues();
  });

fetch("fixtures.json")
  .then(r => r.json())
  .then(data => {
    fixtures = data;
  });

const leagueSelect = document.getElementById("leagueSelect");
const fixtureSelect = document.getElementById("fixtureSelect");
const homeSelect = document.getElementById("homeSelect");
const awaySelect = document.getElementById("awaySelect");
const output = document.getElementById("output");

function populateLeagues() {
  Object.keys(xgData).forEach(lg => {
    const o = document.createElement("option");
    o.value = lg;
    o.textContent = lg;
    leagueSelect.appendChild(o);
  });
}

leagueSelect.onchange = () => {
  const league = leagueSelect.value;

  fixtureSelect.innerHTML = `<option value="">Select Fixture (optional)</option>`;
  homeSelect.innerHTML = `<option value="">Home Team</option>`;
  awaySelect.innerHTML = `<option value="">Away Team</option>`;

  if (!league) return;

  // Teams
  Object.keys(xgData[league]).forEach(t => {
    homeSelect.add(new Option(t, t));
    awaySelect.add(new Option(t, t));
  });

  // Fixtures
  fixtures
    .filter(f => f.league === league)
    .forEach(f => {
      const id = `${f.home} vs ${f.away}`;
      const o = new Option(id, id);
      fixtureSelect.add(o);
    });
};

fixtureSelect.onchange = () => {
  const [home, away] = fixtureSelect.value.split(" vs ");
  homeSelect.value = home || "";
  awaySelect.value = away || "";
};

function runPrediction() {
  const league = leagueSelect.value;
  const home = homeSelect.value;
  const away = awaySelect.value;
  const sims = +document.getElementById("sims").value || 10000;

  if (!league || !home || !away) {
    output.innerHTML = "Select league and teams.";
    return;
  }

  const h = xgData[league][home];
  const a = xgData[league][away];

  const lambdaHome = 1.35 * h.att * a.def * 1.1;
  const lambdaAway = 1.35 * a.att * h.def;

  let hW=0,dW=0,aW=0,over=0,btts=0;

  for (let i=0;i<sims;i++){
    const hg = poisson(lambdaHome);
    const ag = poisson(lambdaAway);
    if (hg>ag) hW++;
    else if (hg===ag) dW++;
    else aW++;
    if (hg+ag>2.5) over++;
    if (hg>0 && ag>0) btts++;
  }

  output.innerHTML = `
    <h3>${home} vs ${away}</h3>
    <div class="pill">1X2: H ${(hW/sims*100).toFixed(1)}% • D ${(dW/sims*100).toFixed(1)}% • A ${(aW/sims*100).toFixed(1)}%</div>
    <div class="pill">O/U 2.5: Over ${(over/sims*100).toFixed(1)}%</div>
    <div class="pill">BTTS Yes ${(btts/sims*100).toFixed(1)}%</div>
    <div class="pill">Pred score: ${Math.round(lambdaHome)}-${Math.round(lambdaAway)}</div>
    <div class="pill">AH lean: ${lambdaHome>lambdaAway ? "Home -0.5" : "Away +0.5"}</div>
    <div class="pill">Corners: ${(8 + (lambdaHome+lambdaAway)).toFixed(1)}</div>
    <div class="pill">Cards: ${(3.5 + Math.random()).toFixed(1)}</div>
    <div class="pill">PRO Grade: ${grade(hW/sims)}</div>
  `;
}

function poisson(l){
  let L=Math.exp(-l),p=1,k=0;
  do {k++;p*=Math.random()} while(p>L);
  return k-1;
}

function grade(p){
  if (p>0.62) return "A";
  if (p>0.55) return "B";
  return "C";
}
