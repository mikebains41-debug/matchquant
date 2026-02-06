/* ======================================================
   MatchQuant app.js — ANDROID SELECT FIX (league -> teams)
   Works with your index.html IDs:
   leagueSelect, homeTeam, awayTeam, runBtn, results, sims, statusLine
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

  function setStatus(msg) {
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
    sel.disabled = false; // force-enable
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  }

  function findEngine() {
    return window.predictMatch || window.simulateMatch || window.predict;
  }

  function wireLeagueHandlers(updateTeams) {
    // Android browsers sometimes don’t fire "change" the way you expect.
    // So we listen to multiple events and also poll briefly after interaction.
    const events = ["change", "input", "click", "touchend"];
    events.forEach((ev) => el.league.addEventListener(ev, () => {
      setTimeout(updateTeams, 0);
      setTimeout(updateTeams, 50);
      setTimeout(updateTeams, 150);
    }));
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
      setStatus("Loading ./data/teams.json…");

      // ✅ Correct GitHub Pages path for repo site
      const teamsByLeague = await loadJSON("./data/teams.json");

      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("teams.json loaded but has no leagues");

      // Populate leagues + enable
      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      const updateTeams = () => {
        const league = el.league.value;

        // Always reset teams first
        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) {
          setStatus("Pick a league.");
          return;
        }

        const teams = teamsByLeague[league];
        if (!Array.isArray(teams) || teams.length === 0) {
          setStatus(`No teams found for "${league}" in teams.json.`);
          return;
        }

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");

        // If you want them enabled even before picking, keep this:
        el.home.disabled = false;
        el.away.disabled = false;

        setStatus(`Loaded ${teams.length} teams for ${league}.`);
      };

      wireLeagueHandlers(updateTeams);

      // Run button
      el.runBtn.addEventListener("click", () => runPrediction(teamsByLeague));

      setResults(`<div style="opacity:.85">Ready. Select league + teams, then Run.</div>`);
      setStatus(`Loaded ${leagues.length} leagues. Select one.`);

      // Debug
      window.__teamsByLeague = teamsByLeague;

    } catch (err) {
      console.error(err);
      setStatus("Error");
      setResults(`
        <div class="card">
          <b>App error</b><br><br>
          ${String(err.message || err)}
          <br><br>
          <b>Quick checks:</b>
          <ul>
            <li>teams.json must be at <code>/data/teams.json</code> in your repo</li>
            <li>index.html IDs must match: leagueSelect, homeTeam, awayTeam</li>
          </ul>
        </div>
      `);
    }
  }

  function runPrediction() {
    const league = el.league.value;
    const home = el.home.value;
    const away = el.away.value;

    if (!league) return setResults(`<div class="card">Pick a league first.</div>`);
    if (!home || !away) return setResults(`<div class="card">Pick both teams.</div>`);
    if (home === away) return setResults(`<div class="card">Teams must be different.</div>`);

    const engine = findEngine();
    if (typeof engine !== "function") {
      return setResults(`
        <div class="card">
          <b>Run button works ✅</b><br><br>
          But <b>engine.js</b> is not exposing a function.<br>
          Expected one of:
          <ul>
            <li>window.predictMatch</li>
            <li>window.simulateMatch</li>
            <li>window.predict</li>
          </ul>
        </div>
      `);
    }

    const payload = { league, home, away, sims: Number(el.sims?.value || 10000) };

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
