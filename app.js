/* MatchQuant app.js (FULL REPLACEMENT)
   Fixes: teams not appearing on GitHub Pages due to wrong relative paths.
   Uses absolute paths: /data/teams.json, /data/xg_2025_2026.json, etc.
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // ---- IDs expected in index.html ----
  // leagueSelect, fixtureSelect, homeTeam, awayTeam, sims, homeAdv, baseGoals, goalCap, results
  const el = {
    league: $("league"),
    fixture: $("fixture"),
    home: $("homeTeam"),
    away: $("awayTeam"),
    sims: $("sims"),
    homeAdv: $("homeAdv"),
    baseGoals: $("baseGoals"),
    goalCap: $("goalCap"),
    results: $("results"),
  };

  function setResults(html) {
    if (!el.results) return;
    el.results.innerHTML = html;
  }

  function opt(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function clearSelect(selectEl, placeholderText) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    selectEl.appendChild(opt("", placeholderText));
  }

  function fillSelect(selectEl, values, placeholderText) {
    clearSelect(selectEl, placeholderText);
    values.forEach((v) => selectEl.appendChild(opt(v, v)));
  }

  // ---- Robust JSON loading (absolute path) ----
  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return await res.json();
  }

  // ---- Normalize teams.json to: { "Premier League": ["Arsenal", ...], ... } ----
  function normalizeTeams(data) {
    // Case A: already object of arrays
    // { "Premier League": ["Arsenal", "Villa"] }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const keys = Object.keys(data);
      // { leagues: {...} } or { teamsByLeague: {...} }
      if (data.leagues && typeof data.leagues === "object") return normalizeTeams(data.leagues);
      if (data.teamsByLeague && typeof data.teamsByLeague === "object") return normalizeTeams(data.teamsByLeague);

      // If each league is {teams:[...]} or {list:[...]}
      const out = {};
      for (const k of keys) {
        const v = data[k];
        if (Array.isArray(v)) out[k] = v;
        else if (v && typeof v === "object") {
          if (Array.isArray(v.teams)) out[k] = v.teams;
          else if (Array.isArray(v.list)) out[k] = v.list;
          else if (Array.isArray(v.items)) out[k] = v.items;
        }
      }
      // If we successfully extracted anything, return it
      if (Object.keys(out).length) return out;
    }

    // Case B: array format
    // [ {league:"Premier League", team:"Arsenal"}, ... ]
    if (Array.isArray(data)) {
      const out = {};
      for (const row of data) {
        if (!row) continue;
        const league = row.league || row.League || row.competition || row.comp;
        const team = row.team || row.Team || row.name;
        if (!league || !team) continue;
        if (!out[league]) out[league] = [];
        out[league].push(team);
      }
      // de-dupe and sort
      for (const k of Object.keys(out)) {
        out[k] = [...new Set(out[k])].sort((a, b) => a.localeCompare(b));
      }
      if (Object.keys(out).length) return out;
    }

    return {}; // fallback
  }

  function uniqueSorted(arr) {
    return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
  }

  // ---- MAIN INIT ----
  async function init() {
    try {
      // Always reset UI first
      clearSelect(el.league, "Select league");
      clearSelect(el.fixture, "Select fixture (optional)");
      clearSelect(el.home, "Select home team");
      clearSelect(el.away, "Select away team");

      setResults(`<div style="opacity:.85">Loading data…</div>`);

      // Load teams
      const rawTeams = await loadJSON("/data/teams.json");
      const teamsByLeague = normalizeTeams(rawTeams);

      const leagues = uniqueSorted(Object.keys(teamsByLeague));
      if (!leagues.length) {
        throw new Error(
          "teams.json loaded but no leagues found. Check its structure."
        );
      }

      // Populate league dropdown
      clearSelect(el.league, "Select league");
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));

      // Helpful status line
      setResults(`<div style="opacity:.85">Loaded ${leagues.length} leagues. Pick league + teams, then press Run Predictions.</div>`);

      // On league change, populate team dropdowns
      el.league.addEventListener("change", () => {
        const league = el.league.value;
        const teams = (teamsByLeague[league] || []).slice();

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");

        // fixtures optional (Phase 3+) – leave empty for now unless you want it later
        clearSelect(el.fixture, "Select fixture (optional)");
      });

      // Run button
      const runBtn = document.querySelector("button#runBtn") || document.querySelector("button[data-run='1']") || document.querySelector("button");
      if (runBtn) {
        runBtn.addEventListener("click", () => runPrediction());
      }

      // Reset button
      const resetBtn = document.querySelector("button#resetBtn");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          el.league.value = "";
          clearSelect(el.fixture, "Select fixture (optional)");
          clearSelect(el.home, "Select home team");
          clearSelect(el.away, "Select away team");
          setResults(`<div style="opacity:.85">Pick league + teams, then press Run Predictions.</div>`);
        });
      }

      // Store globally for debugging
      window.__teamsByLeague = teamsByLeague;
    } catch (err) {
      console.error(err);
      setResults(`
        <div class="card">
          <div style="font-weight:700;">Data load error</div>
          <div style="margin-top:8px;opacity:.9;">
            ${String(err.message || err)}
          </div>
          <div style="margin-top:8px;opacity:.75;">
            Fix checklist:
            <ul>
              <li>Make sure this URL opens: <b>/data/teams.json</b></li>
              <li>Make sure teams.json contains leagues + team lists</li>
              <li>If you changed files, clear cache (service worker) or open in Incognito</li>
            </ul>
          </div>
        </div>
      `);
    }
  }

  // ---- RUN PREDICTION (calls engine.js) ----
  function runPrediction() {
    const league = el.league.value;
    const home = el.home.value;
    const away = el.away.value;

    if (!league || !home || !away) {
      setResults(`<div class="card"><div style="font-weight:700;">Missing selection</div><div style="opacity:.85;margin-top:8px;">Pick a league, home team, and away team.</div></div>`);
      return;
    }
    if (home === away) {
      setResults(`<div class="card"><div style="font-weight:700;">Invalid matchup</div><div style="opacity:.85;margin-top:8px;">Home and Away can’t be the same team.</div></div>`);
      return;
    }

    const payload = {
      league,
      home,
      away,
      sims: Number(el.sims?.value || 10000),
      homeAdv: Number(el.homeAdv?.value || 1.1),
      baseGoals: Number(el.baseGoals?.value || 1.35),
      goalCap: Number(el.goalCap?.value || 8),
    };

    // engine.js should expose one of these
    const fn =
      window.predictMatch ||
      window.predict ||
      window.predictMatchInternal ||
      window.simulateMatch;

    if (typeof fn !== "function") {
      setResults(`
        <div class="card">
          <div style="font-weight:700;">Engine not ready</div>
          <div style="opacity:.85;margin-top:8px;">
            engine.js did not expose a prediction function.
            Expected one of: predictMatch, predict, predictMatchInternal, simulateMatch
          </div>
        </div>
      `);
      return;
    }

    try {
      const out = fn(payload);
      // If engine already returns HTML, render it
      if (typeof out === "string") {
        setResults(out);
      } else {
        // fallback render
        setResults(`<pre style="white-space:pre-wrap;">${JSON.stringify(out, null, 2)}</pre>`);
      }
    } catch (e) {
      console.error(e);
      setResults(`<div class="card"><div style="font-weight:700;">Prediction error</div><div style="opacity:.85;margin-top:8px;">${String(e.message || e)}</div></div>`);
    }
  }

  // Start
  document.addEventListener("DOMContentLoaded", init);
})();
