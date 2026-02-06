/* ======================================================
   MatchQuant app.js — FULL REPLACEMENT (GitHub Pages FIX)
   ====================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    league: $("league"),
    home: $("homeTeam"),
    away: $("awayTeam"),
    sims: $("sims"),
    results: $("results"),
  };

  function setResults(html) {
    if (el.results) el.results.innerHTML = html;
  }

  function opt(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function clearSelect(sel, placeholder) {
    if (!sel) return;
    sel.innerHTML = "";
    sel.appendChild(opt("", placeholder));
  }

  function fillSelect(sel, values, placeholder) {
    clearSelect(sel, placeholder);
    values.forEach(v => sel.appendChild(opt(v, v)));
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function normalizeTeams(data) {
    if (!data || typeof data !== "object") return {};
    if (data.leagues) return data.leagues;
    if (data.teamsByLeague) return data.teamsByLeague;

    const out = {};
    for (const league of Object.keys(data)) {
      if (Array.isArray(data[league])) out[league] = data[league];
    }
    return out;
  }

  async function init() {
    try {
      clearSelect(el.league, "Select league");
      clearSelect(el.home, "Select home team");
      clearSelect(el.away, "Select away team");

      setResults(`<div style="opacity:.7">Loading teams…</div>`);

      // 🔑 IMPORTANT FIX — RELATIVE PATH (NO LEADING SLASH)
      const rawTeams = await loadJSON("https://mikebains41-debug.github.io/data/teams.json");
      const teamsByLeague = normalizeTeams(rawTeams);

      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("No leagues found in teams.json");

      leagues.forEach(lg => el.league.appendChild(opt(lg, lg)));

      el.league.addEventListener("change", () => {
        const teams = teamsByLeague[el.league.value] || [];
        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
      });

      const runBtn = document.querySelector("[data-run]");
      if (runBtn) runBtn.addEventListener("click", runPrediction);

      setResults(`<div style="opacity:.8">Ready</div>`);
      window.__teamsByLeague = teamsByLeague; // debug helper

    } catch (err) {
      console.error(err);
      setResults(`
        <div class="card">
          <b>Error loading app</b><br><br>
          ${err.message}<br><br>
          <b>Checklist:</b>
          <ul>
            <li>teams.json exists in /data</li>
            <li>NO leading slashes in paths</li>
            <li>Repo is public</li>
          </ul>
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

    const payload = {
      league,
      home,
      away,
      sims: Number(el.sims?.value || 10000),
    };

    const engine =
      window.predictMatch ||
      window.predict ||
      window.simulateMatch;

    if (typeof engine !== "function") {
      setResults(`
        <div class="card">
          Engine not found.<br>
          engine.js must expose:
          <ul>
            <li>predictMatch()</li>
            <li>or simulateMatch()</li>
          </ul>
        </div>
      `);
      return;
    }

    try {
      const out = engine(payload);
      setResults(
        typeof out === "string"
          ? out
          : `<pre>${JSON.stringify(out, null, 2)}</pre>`
      );
    } catch (e) {
      console.error(e);
      setResults(`<div class="card">Engine error: ${e.message}</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
