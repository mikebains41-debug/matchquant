document.addEventListener("DOMContentLoaded", () => {
  const leagueEl = document.getElementById("league");
  const homeEl = document.getElementById("home");
  const awayEl = document.getElementById("away");
  const runBtn = document.getElementById("runBtn");
  const statusEl = document.getElementById("status");

  // ✅ Full team lists (manual mode) — no JSON needed
  const leagues = {
    "Premier League": [
      "Arsenal","Aston Villa","Bournemouth","Brentford","Brighton",
      "Chelsea","Crystal Palace","Everton","Fulham","Ipswich Town",
      "Leicester City","Liverpool","Manchester City","Manchester United",
      "Newcastle United","Nottingham Forest","Southampton","Tottenham",
      "West Ham United","Wolverhampton"
    ],
    "La Liga": [
      "Alaves","Athletic Club","Atletico Madrid","Barcelona","Betis","Celta Vigo",
      "Espanyol","Getafe","Girona","Las Palmas","Leganes","Mallorca","Osasuna",
      "Rayo Vallecano","Real Madrid","Real Sociedad","Sevilla","Valencia",
      "Valladolid","Villarreal"
    ],
    "Bundesliga": [
      "Augsburg","Bayern Munich","Bochum","Borussia Dortmund","Borussia Monchengladbach",
      "Eintracht Frankfurt","Freiburg","Heidenheim","Hoffenheim","Holstein Kiel",
      "Mainz","RB Leipzig","St. Pauli","Stuttgart","Union Berlin","Werder Bremen",
      "Wolfsburg","Bayer Leverkusen"
    ],
    "Serie A": [
      "AC Milan","Atalanta","Bologna","Cagliari","Como","Empoli","Fiorentina",
      "Genoa","Inter","Juventus","Lazio","Lecce","Monza","Napoli","Parma",
      "Roma","Torino","Udinese","Venezia","Verona"
    ],
    "Ligue 1": [
      "Angers","Auxerre","Brest","Le Havre","Lens","Lille","Lyon","Marseille",
      "Monaco","Montpellier","Nantes","Nice","PSG","Rennes","Reims",
      "Saint-Etienne","Strasbourg","Toulouse"
    ]
  };

  function resetSelect(el, placeholder) {
    el.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    el.appendChild(opt);
  }

  function fillSelect(el, items) {
    for (const t of items) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      el.appendChild(o);
    }
  }

  // Populate leagues dropdown
  resetSelect(leagueEl, "Select league");
  Object.keys(leagues).forEach(lg => {
    const o = document.createElement("option");
    o.value = lg;
    o.textContent = lg;
    leagueEl.appendChild(o);
  });

  // Init team dropdowns
  resetSelect(homeEl, "Select home");
  resetSelect(awayEl, "Select away");

  leagueEl.addEventListener("change", () => {
    const lg = leagueEl.value;
    resetSelect(homeEl, "Select home");
    resetSelect(awayEl, "Select away");
    if (leagues[lg]) {
      fillSelect(homeEl, leagues[lg]);
      fillSelect(awayEl, leagues[lg]);
    }
  });

  runBtn.addEventListener("click", () => {
    if (!window.runPrediction) {
      alert("MatchQuant says\n\nEngine not loaded.");
      return;
    }

    const league = leagueEl.value;
    const home = homeEl.value;
    const away = awayEl.value;

    if (!league || !home || !away) {
      alert("MatchQuant says\n\nSelect league, home, and away.");
      return;
    }
    if (home === away) {
      alert("MatchQuant says\n\nHome and Away cannot be the same team.");
      return;
    }

    const sims = Number(document.getElementById("sims").value || 10000);
    const homeAdv = Number(document.getElementById("homeAdv").value || 1.10);
    const baseGoals = Number(document.getElementById("baseGoals").value || 1.35);
    const capGoals = Number(document.getElementById("capGoals").value || 8);

    const params = { league, home, away, sims, homeAdv, baseGoals, capGoals };

    try {
      window.runPrediction(params);
    } catch (e) {
      alert("MatchQuant says\n\nPrediction error.");
      console.error(e);
    }
  });

  statusEl.textContent = "Ready ✔ Manual mode (engine-driven)";
});
