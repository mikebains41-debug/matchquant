/* MatchQuant app.js — FINAL STABLE */

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
    leagueSel.add(new Option(l, l));
  });
  leagueSel.onchange = loadTeams;
  loadTeams();
}

function loadTeams() {
  homeSel.innerHTML = "";
  awaySel.innerHTML = "";

  const leagueObj = xgRaw[leagueSel.value];
  Object.keys(leagueObj)
    .filter(k => !k.startsWith("__"))
    .forEach(team => {
      homeSel.add(new Option(team, team));
      awaySel.add(new Option(team, team));
    });
}

runBtn.onclick = () => {
  window.runPrediction({
    league: leagueSel.value,
    home: homeSel.value,
    away: awaySel.value,
    homeAdv: Number(document.getElementById("homeAdv").value || 1.1),
    baseGoals: Number(document.getElementById("baseGoals").value || 1.35),
    capGoals: Number(document.getElementById("capGoals").value || 8),
    ahSide: document.getElementById("ahSide")?.value || null,
    ahLine: document.getElementById("ahLine")?.value || null,
    xgRaw
  });
};
