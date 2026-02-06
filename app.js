// app.js (MatchQuant) — robust league/team loader for GitHub Pages
(function () {
  const $ = (id) => document.getElementById(id);

  const leagueEl = $("league");
  const homeEl = $("homeTeam");
  const awayEl = $("awayTeam");
  const resultsEl = $("results");
  const runBtn = $("runBtn");

  // Fallback league names (used only if teams.json is index-based)
  const DEFAULT_LEAGUE_NAMES = [
    "Premier League",
    "La Liga",
    "Serie A",
    "Bundesliga",
    "Ligue 1",
    "Primeira Liga",
    "Eredivisie",
    "Scottish Premiership",
    "RFPL"
  ];

  function setStatus(msg) {
    if (resultsEl) resultsEl.textContent = msg;
  }

  function clearSelect(sel) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
  }

  function addOption(sel, value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  function normalizeTeamsJson(raw) {
    // We want: { leagueName: [teamName, ...], ... }
    // Support shapes:
    // 1) { "Premier League": ["Arsenal", ...], "La Liga": [...] }
    // 2) [ ["Arsenal",...], ["Real Madrid",...], ... ]  (array of arrays)
    // 3) [ { name: "Premier League", teams: [...] }, ... ]
    // 4) { "0": [...], "1":[...], ... } (index keys)

    const map = {};

    if (Array.isArray(raw)) {
      if (raw.length && typeof raw[0] === "object" && !Array.isArray(raw[0])) {
        // array of objects
        for (let i = 0; i < raw.length; i++) {
          const obj = raw[i] || {};
          const name = (obj.name || obj.league || DEFAULT_LEAGUE_NAMES[i] || `League ${i + 1}`).toString();
          const teams = Array.isArray(obj.teams) ? obj.teams : [];
          map[name] = teams.map(String);
        }
      } else {
        // array of arrays
        for (let i = 0; i < raw.length; i++) {
          const name = DEFAULT_LEAGUE_NAMES[i] || `League ${i + 1}`;
          const teams = Array.isArray(raw[i]) ? raw[i] : [];
          map[name] = teams.map(String);
        }
      }
      return map;
    }

    if (raw && typeof raw === "object") {
      const keys = Object.keys(raw);

      // If keys look like 0..N, map them to DEFAULT_LEAGUE_NAMES
      const allNumeric = keys.length && keys.every((k) => String(+k) === k);
      if (allNumeric) {
        keys.sort((a, b) => (+a) - (+b));
        keys.forEach((k, i) => {
          const name = DEFAULT_LEAGUE_NAMES[i] || `League ${i + 1}`;
          const teams = Array.isArray(raw[k]) ? raw[k] : [];
          map[name] = teams.map(String);
        });
        return map;
      }

      // Normal object keyed by league name
      for (const k of keys) {
        const teams = Array.isArray(raw[k]) ? raw[k] : [];
        map[String(k)] = teams.map(String);
      }
      return map;
    }

    return map;
  }

  async function loadJSON(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  function populateLeagueSelect(teamMap) {
    clearSelect(leagueEl);
    const leagues = Object.keys(teamMap);

    if (!leagues.length) {
      addOption(leagueEl, "", "No leagues found");
      return;
    }

    leagues.forEach((name) => addOption(leagueEl, name, name));
  }

  function populateTeamSelects(teamMap, leagueName) {
    const teams = teamMap[leagueName] || [];

    clearSelect(homeEl);
    clearSelect(awayEl);

    if (!teams.length) {
      addOption(homeEl, "", "No teams found");
      addOption(awayEl, "", "No teams found");
      return;
    }

    teams.forEach((t) => {
      addOption(homeEl, t, t);
      addOption(awayEl, t, t);
    });

    // Default: home first team, away second team (if possible)
    homeEl.value = teams[0];
    awayEl.value = teams[1] || teams[0];
  }

  async function init() {
    try {
      setStatus("Loading teams...");
      const rawTeams = await loadJSON("data/teams.json");
      const teamMap = normalizeTeamsJson(rawTeams);

      populateLeagueSelect(teamMap);
      const firstLeague = leagueEl.value;
      populateTeamSelects(teamMap, firstLeague);

      leagueEl.addEventListener("change", () => {
        populateTeamSelects(teamMap, leagueEl.value);
      });

      // Run button (calls your existing engine if present)
      runBtn?.addEventListener("click", () => {
        try {
          const payload = {
            league: leagueEl.value,
            home: homeEl.value,
            away: awayEl.value,
            sims: Number($("sims")?.value || 10000),
            homeAdv: Number($("homeAdv")?.value || 1.1),
            baseGoals: Number($("baseGoals")?.value || 1.35),
          };

          // If your engine exposes something, call it; otherwise show payload
          if (window.MatchQuantEngine && typeof window.MatchQuantEngine.run === "function") {
            const out = window.MatchQuantEngine.run(payload);
            resultsEl.textContent = typeof out === "string" ? out : JSON.stringify(out, null, 2);
          } else if (typeof window.runPrediction === "function") {
            const out = window.runPrediction(payload);
            resultsEl.textContent = typeof out === "string" ? out : JSON.stringify(out, null, 2);
          } else {
            resultsEl.textContent =
              "Engine hook not found (engine.js). Teams dropdowns are fixed.\n\n" +
              JSON.stringify(payload, null, 2);
          }
        } catch (e) {
          resultsEl.textContent = "Run error: " + (e?.message || e);
        }
      });

      setStatus("Loaded. Pick league + teams, then press Run Prediction.");
    } catch (e) {
      setStatus("ERROR: " + (e?.message || e));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
