/* ======================================================
   MatchQuant app.js — FULL WORKING VERSION (ID FIXED)
   ====================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    league: $("leagueSelect"),
    home: $("homeTeam"),
    away: $("awayTeam"),
    sims: $("sims"),
    results: $("results"),
    runBtn: $("runBtn"),
  };

  function setResults(html) {
    el.results.innerHTML = html;
  }

  function opt(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function clearSelect(sel, placeholder) {
    sel.innerHTML = "";
    sel.appendChild(opt("", placeholder));
    sel.disabled = true;
  }

  function fillSelect(sel, values, placeholder) {
    clearSelect(sel, placeholder);
    values.forEach(v => sel.appendChild(opt(v, v)));
    sel.disabled = false;
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  async function init() {
    try {
      clearSelect(el.league, "Select league");
      clearSelect(el.home, "Select home team");
      clearSelect(el.away, "Select away team");

      setResults(`<div style="opacity:.7">Loading leagues…</div>`);

      // ✅ Correct path (you already confirmed this works)
      const teamsByLeague = await loadJSON("./data/teams.json");

      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("No leagues found");

      leagues.forEach(lg => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      el.league.addEventListener("change", () => {
        const teams = teamsByLeague[el.league.value] || [];
        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
      });

      el.runBtn.addEventListener("click", runPrediction);

      setResults(`<div style="opacity:.8">Ready</div>`);
      window.__teams = teamsByLeague; // debug

    } catch (err) {
      console.error(err);
      setResults(`
        <div class="card">
          <b>Error</b><br><br>
          ${err.message}
        </div>
      `);
    }
  }

  function runPrediction() {
    const league = el.league.value;
    const home = el.home.value;
    const away = el.away.value;

    if (!league || !home || !away) {
      setResults(`<div class="card">Select league and teams</div>`);
      return;
    }
    if (home === away) {
      setResults(`<div class="card">Teams must be different</div>`);
      return;
    }

    const engine =
      window.predictMatch ||
      window.simulateMatch;

    if (typeof engine !== "function") {
      setResults(`<div class="card">Prediction engine not found</div>`);
      return;
    }

    const payload = {
      league,
      home,
      away,
      sims: Number(el.sims.value || 10000),
    };

    const out = engine(payload);
    setResults(`<pre>${JSON.stringify(out, null, 2)}</pre>`);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
