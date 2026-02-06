/* ======================================================
   MatchQuant app.js — Teams + Run FIX (works w/ your index.html)
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
    status: $("statusLine"),
  };

  function log(msg) {
    if (el.status) el.status.textContent = msg;
  }

  function setResults(html) {
    if (el.results) el.results.innerHTML = html;
  }

  function opt(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function resetSelect(sel, placeholder, disabled = true) {
    if (!sel) return;
    sel.innerHTML = "";
    sel.appendChild(opt("", placeholder));
    sel.disabled = disabled;
  }

  function fillSelect(sel, values, placeholder) {
    resetSelect(sel, placeholder, false);
    values.forEach((v) => sel.appendChild(opt(v, v)));
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  }

  function findEngine() {
    return (
      window.predictMatch ||
      window.simulateMatch ||
      window.predict ||
      window.predictMatchInternal ||
      window.simulateMatchInternal
    );
  }

  async function init() {
    try {
      if (!el.league || !el.home || !el.away || !el.runBtn || !el.results) {
        throw new Error("Missing required HTML IDs. Check index.html IDs.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      setResults(`<div style="opacity:.75">Loading leagues…</div>`);
      log("Loading teams.json…");

      // ✅ Use relative path for GitHub Pages repo site
      // If your teams.json is at /data/teams.json, this is correct:
      const teamsByLeague = await loadJSON("./data/teams.json");

      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("teams.json loaded but has no leagues");

      // Populate leagues + enable
      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));

      log(`Loaded ${leagues.length} leagues. Pick one.`);

      // League change => populate teams + enable
      el.league.addEventListener("change", () => {
        const league = el.league.value;
        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) {
          log("Pick a league.");
          return;
        }

        const teams = teamsByLeague[league] || [];
        if (!teams.length) {
          log(`No teams found for ${league}.`);
          return;
        }

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
        log(`Loaded ${teams.length} teams for ${league}.`);
      });

      // Run button click
      el.runBtn.addEventListener("click", () => runPrediction(teamsByLeague));

      setResults(`<div style="opacity:.85">Ready. Select league + teams, then Run.</div>`);

      // Debug helper
      window.__teamsByLeague = teamsByLeague;

    } catch (err) {
      console.error(err);
      log("Error");
      setResults(`
        <div class="card">
          <b>App error</b><br><br>
          ${String(err.message || err)}
          <br><br>
          <b>Quick checks:</b>
          <ul>
            <li>index.html IDs are: leagueSelect, homeTeam, awayTeam, runBtn, results</li>
            <li>teams.json path is ./data/teams.json</li>
          </ul>
        </div>
      `);
    }
  }

  function runPrediction(teamsByLeague) {
    const league = el.league.value;
    const home = el.home.value;
    const away = el.away.value;

    if (!league) {
      setResults(`<div class="card">Pick a league first.</div>`);
      return;
    }
    if (!home || !away) {
      setResults(`<div class="card">Pick both teams.</div>`);
      return;
    }
    if (home === away) {
      setResults(`<div class="card">Teams must be different.</div>`);
      return;
    }

    const engine = findEngine();
    if (typeof engine !== "function") {
      setResults(`
        <div class="card">
          <b>Run button works ✅</b><br><br>
          But <b>engine.js</b> is not exposing a function.<br>
          Expected one of:
          <ul>
            <li>window.predictMatch</li>
            <li>window.simulateMatch</li>
            <li>window.predict</li>
          </ul>
          <div style="opacity:.8;margin-top:8px">
            Fix: in engine.js, add: <code>window.predictMatch = predictMatch;</code>
          </div>
        </div>
      `);
      return;
    }

    const payload = {
      league,
      home,
      away,
      sims: Number(el.sims?.value || 10000),
    };

    try {
      const out = engine(payload);
      setResults(
        typeof out === "string"
          ? out
          : `<pre style="white-space:pre-wrap">${JSON.stringify(out, null, 2)}</pre>`
      );
    } catch (e) {
      console.error(e);
      setResults(`<div class="card">Engine error: ${e.message}</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
