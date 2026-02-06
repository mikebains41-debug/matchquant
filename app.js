/* ======================================================
   MatchQuant app.js — FULL REPLACEMENT (GitHub Pages FIX)
   Works with your index.html IDs:
   leagueSelect, fixtureSelect, homeTeam, awayTeam,
   sims, homeAdv, baseGoals, goalCap,
   runBtn, resetBtn, results, statusLine
   ====================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  // ---- Elements (MUST match index.html IDs) ----
  const el = {
    league: $("leagueSelect"),
    fixture: $("fixtureSelect"),
    home: $("homeTeam"),
    away: $("awayTeam"),
    sims: $("sims"),
    homeAdv: $("homeAdv"),
    baseGoals: $("baseGoals"),
    goalCap: $("goalCap"),
    runBtn: $("runBtn"),
    resetBtn: $("resetBtn"),
    results: $("results"),
    status: $("statusLine"),
  };

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
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

  function clearSelect(sel, placeholder, keepDisabled = false) {
    if (!sel) return;
    sel.innerHTML = "";
    sel.appendChild(opt("", placeholder));
    sel.disabled = !!keepDisabled;
  }

  function fillSelect(sel, values, placeholder) {
    clearSelect(sel, placeholder, false);
    (values || []).forEach((v) => sel.appendChild(opt(v, v)));
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
    return await res.json();
  }

  // Accepts formats:
  // { "Premier League": ["Arsenal", ...], "La Liga": [...] }
  // { leagues: { ... } }
  // { teamsByLeague: { ... } }
  function normalizeTeams(data) {
    if (!data || typeof data !== "object") return {};
    if (data.leagues && typeof data.leagues === "object") return data.leagues;
    if (data.teamsByLeague && typeof data.teamsByLeague === "object")
      return data.teamsByLeague;

    const out = {};
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k])) out[k] = data[k];
    }
    return out;
  }

  function safeNum(val, fallback) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  // ---- Main init ----
  async function init() {
    try {
      // Reset UI
      clearSelect(el.league, "Select league", true);
      clearSelect(el.fixture, "Select fixture (optional)", true);
      clearSelect(el.home, "Select home team", true);
      clearSelect(el.away, "Select away team", true);

      setStatus("Loading teams…");
      setResults(`<div style="opacity:.8">Loading…</div>`);

      // ✅ Correct path for GitHub Pages repo folder:
      // If your site is /matchquant/, this becomes:
      // https://.../matchquant/data/teams.json
      const rawTeams = await loadJSON("./data/teams.json");
      const teamsByLeague = normalizeTeams(rawTeams);

      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("No leagues found in teams.json");

      // Populate leagues
      clearSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      // When league changes, populate teams
      el.league.addEventListener("change", () => {
        const lg = el.league.value;
        const teams = teamsByLeague[lg] || [];
        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
        el.home.disabled = false;
        el.away.disabled = false;

        // fixtures optional (kept disabled unless you add fixtures.json wiring)
        clearSelect(el.fixture, "Select fixture (optional)", true);

        setStatus(lg ? `Loaded ${teams.length} teams` : "Select a league");
      });

      // Buttons
      if (el.runBtn) el.runBtn.addEventListener("click", runPrediction);

      if (el.resetBtn) {
        el.resetBtn.addEventListener("click", () => {
          el.league.value = "";
          clearSelect(el.fixture, "Select fixture (optional)", true);
          clearSelect(el.home, "Select home team", true);
          clearSelect(el.away, "Select away team", true);
          setStatus("Reset");
          setResults(
            `Pick league + teams, then press <b>Run Predictions</b>.`
          );
        });
      }

      // Debug helpers
      window.__teamsByLeague = teamsByLeague;

      setStatus("Ready");
      setResults(`Pick league + teams, then press <b>Run Predictions</b>.`);
    } catch (err) {
      console.error(err);
      setStatus("Error");
      setResults(`
        <div class="card">
          <b>Error loading app</b><br><br>
          ${String(err.message || err)}<br><br>
          <b>Fix checklist:</b>
          <ul>
            <li>Make sure <code>data/teams.json</code> exists in this repo</li>
            <li>Make sure the URL works: <code>/matchquant/data/teams.json</code></li>
            <li>Repo must be public</li>
            <li>GitHub Pages must be enabled for this repo</li>
          </ul>
        </div>
      `);
    }
  }

  // ---- Run Prediction ----
  function runPrediction() {
    const league = el.league?.value || "";
    const home = el.home?.value || "";
    const away = el.away?.value || "";

    if (!league || !home || !away) {
      setResults(`<div class="card">Select league + home + away</div>`);
      return;
    }
    if (home === away) {
      setResults(`<div class="card">Home and Away must be different</div>`);
      return;
    }

    const payload = {
      league,
      home,
      away,
      sims: safeNum(el.sims?.value, 10000),
      homeAdv: safeNum(el.homeAdv?.value, 1.1),
      baseGoals: safeNum(el.baseGoals?.value, 1.35),
      goalCap: safeNum(el.goalCap?.value, 8),
    };

    // engine.js must expose ONE of these functions:
    const engine =
      window.predictMatch ||
      window.predict ||
      window.predictMatchInternal ||
      window.simulateMatch;

    if (typeof engine !== "function") {
      setResults(`
        <div class="card">
          <b>Engine not found.</b><br><br>
          Your <code>engine.js</code> must set one of:
          <ul>
            <li><code>window.predictMatch = function(payload) { ... }</code></li>
            <li><code>window.simulateMatch = function(payload) { ... }</code></li>
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
          : `<pre style="white-space:pre-wrap">${JSON.stringify(out, null, 2)}</pre>`
      );
    } catch (e) {
      console.error(e);
      setResults(`<div class="card">Engine error: ${e.message}</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
