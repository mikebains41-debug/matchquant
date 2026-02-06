/* MatchQuant app.js — FINAL */

let xgRaw = null;

const leagueSel = document.getElementById("league");
const homeSel = document.getElementById("home");
const awaySel = document.getElementById("away");
const runBtn = document.getElementById("runBtn");

fetch("xg_tables.json")
  .then(r => r.json())
  .then(data => {
    xgRaw = data;
    loadLeagues();
  });

function loadLeagues() {
  leagueSel.innerHTML = "";
  Object.keys(xgRaw).forEach(l => {
    const opt = document.createElement("option");
    opt.value = l;
    opt.textContent = l;
    leagueSel.appendChild(opt);
  });
  leagueSel.onchange = loadTeams;
  loadTeams();
}

function loadTeams() {
  homeSel.innerHTML = "";
  awaySel.innerHTML = "";

  const league = leagueSel.value;
  const leagueObj = xgRaw[league];

  Object.keys(leagueObj)
    .filter(k => !k.startsWith("__"))
    .forEach(team => {
      const o1 = new Option(team, team);
      const o2 = new Option(team, team);
      homeSel.add(o1);
      awaySel.add(o2);
    });
}

runBtn.onclick = () => {
  window.runPrediction({
    league: leagueSel.value,
    home: homeSel.value,
    away: awaySel.value,
    homeAdv: Number(document.getElementById("homeAdv").value),
    baseGoals: Number(document.getElementById("baseGoals").value),
    capGoals: Number(document.getElementById("capGoals").value),
    ahSide: document.getElementById("ahSide")?.value,
    ahLine: document.getElementById("ahLine")?.value,
    xgRaw
  });
};
