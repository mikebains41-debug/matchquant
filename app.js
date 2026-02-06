// MatchQuant App Controller
// FIXED: league names, team loading, clean bindings

let TEAMS = {};
let LEAGUE_STRENGTH = {};
let XG_DATA = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadData();
  populateLeagues();
  bindEvents();
}

async function loadData() {
  const [teams, leagueStrength, xg] = await Promise.all([
    fetch("data/teams.json").then(r => r.json()),
    fetch("data/league_strength.json").then(r => r.json()),
    fetch("data/xg_2025_2026.json").then(r => r.json())
  ]);

  TEAMS = teams;
  LEAGUE_STRENGTH = leagueStrength;
  XG_DATA = xg;
}

function populateLeagues() {
  const leagueSelect = document.getElementById("league");
  leagueSelect.innerHTML = "";

  Object.keys(TEAMS).forEach(league => {
    const opt = document.createElement("option");
    opt.value = league;
    opt.textContent = league;
    leagueSelect.appendChild(opt);
  });

  populateTeams(leagueSelect.value);
}

function populateTeams(league) {
  const home = document.getElementById("homeTeam");
  const away = document.getElementById("awayTeam");

  home.innerHTML = "";
  away.innerHTML = "";

  TEAMS[league].forEach(team => {
    const o1 = new Option(team, team);
    const o2 = new Option(team, team);
    home.add(o1);
    away.add(o2);
  });

  away.selectedIndex = 1;
}

function bindEvents() {
  document.getElementById("league").addEventListener("change", e => {
    populateTeams(e.target.value);
  });

  document.getElementById("runSim").addEventListener("click", runSimulation);
}

function runSimulation() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("homeTeam").value;
  const away = document.getElementById("awayTeam").value;

  const sims = Number(document.getElementById("sims").value || 10000);
  const homeAdv = Number(document.getElementById("homeAdv").value || 1.1);
  const baseGoals = Number(document.getElementById("baseGoals").value || 1.35);
  const cap = Number(document.getElementById("goalCap").value || 8);

  const result = simulateMatch({
    league,
    home,
    away,
    sims,
    homeAdv,
    baseGoals,
    cap,
    xgData: XG_DATA,
    leagueStrength: LEAGUE_STRENGTH
  });

  displayResult(result);
}

function displayResult(r) {
  document.getElementById("result").innerHTML = `
    <h3>Predicted Score</h3>
    <p><strong>${r.home}</strong> ${r.avgHome.toFixed(2)} – ${r.avgAway.toFixed(2)} <strong>${r.away}</strong></p>

    <h4>Markets</h4>
    <p>Home Win: ${(r.homeWin * 100).toFixed(1)}%</p>
    <p>Draw: ${(r.draw * 100).toFixed(1)}%</p>
    <p>Away Win: ${(r.awayWin * 100).toFixed(1)}%</p>
    <p>Over 2.5 Goals: ${(r.over25 * 100).toFixed(1)}%</p>
  `;
}
