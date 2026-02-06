/* MatchQuant app.js — Teams from teams.json (Option B) */

let TEAMS_BY_LEAGUE = {};

// ---------------- LOAD TEAMS ----------------
async function loadTeamsJson() {
  const res = await fetch("./data/teams.json?v=1");
  if (!res.ok) throw new Error("Failed to load teams.json");
  TEAMS_BY_LEAGUE = await res.json();
}

// ---------------- HELPERS ----------------
function fillSelect(selectEl, items, placeholder) {
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  items.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function getTeamsForLeague(league) {
  return (TEAMS_BY_LEAGUE[league] || []).slice().sort();
}

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadTeamsJson();

    const leagueSel = document.getElementById("league");
    const homeSel = document.getElementById("homeTeam");
    const awaySel = document.getElementById("awayTeam");
    const runBtn = document.getElementById("runBtn");
    const resultsEl = document.getElementById("results");

    // Populate leagues
    const leagues = Object.keys(TEAMS_BY_LEAGUE).sort();
    fillSelect(leagueSel, leagues, "Choose league");

    // On league change → populate teams
    leagueSel.addEventListener("change", () => {
      const league = leagueSel.value;
      const teams = getTeamsForLeague(league);
      fillSelect(homeSel, teams, "Home team");
      fillSelect(awaySel, teams, "Away team");
    });

    // Auto-select first league
    if (leagues.length) {
      leagueSel.value = leagues[0];
      leagueSel.dispatchEvent(new Event("change"));
    }

    // Run prediction
    runBtn.addEventListener("click", () => {
      const league = leagueSel.value;
      const home = homeSel.value;
      const away = awaySel.value;

      if (!league || !home || !away || home === away) {
        resultsEl.innerHTML = "Select league, home team, and away team.";
        return;
      }

      const params = {
        league,
        home,
        away,
        homeAdv: parseFloat(document.getElementById("homeAdv").value || 1.1),
        baseGoals: parseFloat(document.getElementById("baseGoals").value || 1.35),
        capGoals: 10
      };

      const out = window.runPrediction(params);
      resultsEl.innerHTML = out;
    });

  } catch (err) {
    console.error(err);
    alert("Failed to initialize MatchQuant");
  }
});
