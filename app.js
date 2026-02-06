// ================================
// MatchQuant UI Controller
// ================================

let TEAMS = {};
let CURRENT_LEAGUE = null;

// ---------- DOM ----------
const leagueSelect = document.getElementById("league");
const homeSelect = document.getElementById("homeTeam");
const awaySelect = document.getElementById("awayTeam");
const resultsDiv = document.getElementById("results");

// ---------- LOAD DATA ----------
fetch("data/teams.json")
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    populateLeagues();
  })
  .catch(err => {
    console.error("Failed to load teams.json", err);
  });

// ---------- POPULATE LEAGUES ----------
function populateLeagues() {
  leagueSelect.innerHTML = "";

  Object.keys(TEAMS).forEach(leagueName => {
    const opt = document.createElement("option");
    opt.value = leagueName;
    opt.textContent = leagueName;
    leagueSelect.appendChild(opt);
  });

  // auto-select first league
  CURRENT_LEAGUE = leagueSelect.value;
  populateTeams(CURRENT_LEAGUE);
}

// ---------- POPULATE TEAMS ----------
function populateTeams(leagueName) {
  homeSelect.innerHTML = "";
  awaySelect.innerHTML = "";

  if (!TEAMS[leagueName]) return;

  Object.keys(TEAMS[leagueName]).forEach(team => {
    const opt1 = document.createElement("option");
    opt1.value = team;
    opt1.textContent = team;
    homeSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = team;
    opt2.textContent = team;
    awaySelect.appendChild(opt2);
  });

  // default away != home
  if (awaySelect.options.length > 1) {
    awaySelect.selectedIndex = 1;
  }
}

// ---------- EVENTS ----------
leagueSelect.addEventListener("change", e => {
  CURRENT_LEAGUE = e.target.value;
  populateTeams(CURRENT_LEAGUE);
});

// ---------- RUN PREDICTION ----------
function runPrediction() {
  const home = homeSelect.value;
  const away = awaySelect.value;

  if (!home || !away || home === away) {
    resultsDiv.innerHTML = "Select two different teams.";
    return;
  }

  const result = runEngine(
    CURRENT_LEAGUE,
    home,
    away
  );

  renderResults(result);
}

// ---------- RENDER ----------
function renderResults(r) {
  resultsDiv.innerHTML = `
    <h3>${r.match}</h3>
    <p><b>Predicted Score:</b> ${r.scoreline}</p>
    <p><b>Home Win:</b> ${(r.homeWin * 100).toFixed(1)}%</p>
    <p><b>Draw:</b> ${(r.draw * 100).toFixed(1)}%</p>
    <p><b>Away Win:</b> ${(r.awayWin * 100).toFixed(1)}%</p>
    <p><b>Over 2.5:</b> ${(r.over25 * 100).toFixed(1)}%</p>
    <p><b>BTTS:</b> ${(r.btts * 100).toFixed(1)}%</p>
    <p><b>AH Lean:</b> ${r.ahLean}</p>
  `;
}

// expose for button
window.runPrediction = runPrediction;
