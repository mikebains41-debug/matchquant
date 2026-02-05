document.addEventListener("DOMContentLoaded", () => {

  const leagueEl = document.getElementById("league");
  const homeEl = document.getElementById("home");
  const awayEl = document.getElementById("away");
  const runBtn = document.getElementById("runBtn");
  const statusEl = document.getElementById("status");

  const leagues = {
    "Premier League": ["Arsenal", "Chelsea", "Liverpool", "Man City"],
    "La Liga": ["Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla"],
    "Bundesliga": ["Bayern Munich", "RB Leipzig", "Dortmund"],
    "Serie A": ["Inter", "AC Milan", "Juventus"],
    "Ligue 1": ["PSG", "Marseille", "Lyon"]
  };

  function resetSelect(el, placeholder) {
    el.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    el.appendChild(opt);
  }

  function fillSelect(el, items) {
    items.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      el.appendChild(o);
    });
  }

  // Populate leagues
  resetSelect(leagueEl, "Select league");
  Object.keys(leagues).forEach(lg => {
    const o = document.createElement("option");
    o.value = lg;
    o.textContent = lg;
    leagueEl.appendChild(o);
  });

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
      alert("Engine not loaded.");
      return;
    }

    const league = leagueEl.value;
    const home = homeEl.value;
    const away = awayEl.value;

    if (!league || !home || !away || home === away) {
      alert("Select valid league, home and away teams.");
      return;
    }

    const params = {
      league,
      home,
      away,
      sims: Number(document.getElementById("sims").value),
      homeAdv: Number(document.getElementById("homeAdv").value),
      baseGoals: Number(document.getElementById("baseGoals").value),
      capGoals: Number(document.getElementById("capGoals").value)
    };

    window.runPrediction(params);
  });

  statusEl.textContent = "Ready ✔ Manual mode (engine-driven)";
});
