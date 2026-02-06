/* MatchQuant UI wiring (Phase 2) - robust loader + dropdown population + engine call */

(function () {
  const $ = (id) => document.getElementById(id);

  const leagueEl = $("league");
  const fixtureEl = $("fixture");
  const homeEl = $("homeTeam");
  const awayEl = $("awayTeam");

  const simsEl = $("sims");
  const homeAdvEl = $("homeAdv");
  const baseGoalsEl = $("baseGoals");
  const goalCapEl = $("goalCap");

  const runBtn = $("runBtn");
  const resetBtn = $("resetBtn");
  const resultsEl = $("results");
  const statusLine = $("statusLine");

  const DATA = {
    teams: null,
    league_strength: null,
    xg: null,
    aliases: null,
  };

  const STATE = {
    leagues: [],                // string[]
    teamsByLeague: new Map(),   // league -> string[]
    currentLeague: "",
  };

  function setStatus(msg) {
    if (statusLine) statusLine.textContent = msg;
  }

  function setResults(html) {
    resultsEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function optionize(selectEl, items, placeholder) {
    const cur = selectEl.value;
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder || "Select";
    selectEl.appendChild(ph);

    for (const it of items) {
      const opt = document.createElement("option");
      opt.value = it;
      opt.textContent = it;
      selectEl.appendChild(opt);
    }

    // Try to keep selection if still exists
    if (items.includes(cur)) selectEl.value = cur;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  // Build { league -> [teams...] } from many possible shapes
  function normalizeTeamsJson(raw) {
    // Case 1: { "Premier League": ["Arsenal", ...], "La Liga": [...] }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      const looksLikeLeagueMap = keys.length > 0 && keys.every(k => Array.isArray(raw[k]));
      if (looksLikeLeagueMap) {
        const map = new Map();
        for (const league of keys) {
          const teams = raw[league].map(String).filter(Boolean);
          map.set(String(league), uniqSorted(teams));
        }
        return map;
      }
    }

    // Case 2: [ { league: "Premier League", teams: ["Arsenal", ...] }, ... ]
    if (Array.isArray(raw)) {
      const map = new Map();

      for (const row of raw) {
        if (!row) continue;

        // 2a: row has league + teams array
        if (typeof row === "object" && row.league && Array.isArray(row.teams)) {
          const league = String(row.league);
          const teams = row.teams.map(String).filter(Boolean);
          if (!map.has(league)) map.set(league, []);
          map.set(league, uniqSorted(map.get(league).concat(teams)));
          continue;
        }

        // 2b: row is a team record: { league: "...", team: "..." } or { league: "...", name: "..." }
        if (typeof row === "object" && row.league) {
          const league = String(row.league);
          const team = row.team ?? row.name ?? row.club ?? row.Team ?? row.Name;
          if (team) {
            if (!map.has(league)) map.set(league, []);
            map.get(league).push(String(team));
          }
          continue;
        }
      }

      // if map filled, return it
      if (map.size > 0) {
        for (const [league, teams] of map.entries()) {
          map.set(league, uniqSorted(teams.map(String).filter(Boolean)));
        }
        return map;
      }
    }

    // Fallback
    return new Map();
  }

  function uniqSorted(arr) {
    return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
  }

  function enable(el, on) {
    el.disabled = !on;
  }

  function renderError(title, detail) {
    return `
      <div class="card">
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(title)}</div>
        <div style="opacity:.85;white-space:pre-wrap;">${escapeHtml(detail)}</div>
        <div style="opacity:.7;margin-top:8px;">
          Tip: GitHub Pages can cache old JS. Do a hard refresh or clear site data.
        </div>
      </div>
    `;
  }

  function engineFn() {
    return (
      window.predictMatchInternal ||
      window.predict ||
      window.simulateMatch ||
      null
    );
  }

  function prettyCard(obj) {
    // Best-effort rendering if engine returns an object
    const league = obj.league ?? obj.competition ?? "";
    const home = obj.home ?? obj.homeTeam ?? "";
    const away = obj.away ?? obj.awayTeam ?? "";
    const score = obj.mostLikelyScore ?? obj.scoreline ?? "";
    const pScore = obj.mostLikelyScoreProb ?? obj.scoreProb ?? null;

    const xgH = obj.lambdaHome ?? obj.xgHome ?? obj.homeXg ?? null;
    const xgA = obj.lambdaAway ?? obj.xgAway ?? obj.awayXg ?? null;

    const pHome = obj.pHome ?? obj.homeWin ?? null;
    const pDraw = obj.pDraw ?? obj.draw ?? null;
    const pAway = obj.pAway ?? obj.awayWin ?? null;

    const lean = obj.lean ?? obj.edge ?? obj.pick ?? "";

    const pct = (x) => (x == null ? "" : `${(Number(x) * 100).toFixed(1)}%`);

    return `
      <div class="card">
        <div style="font-size:1.1rem;font-weight:800;margin-bottom:10px;">
          ${escapeHtml(league)}: ${escapeHtml(home)} vs ${escapeHtml(away)}
        </div>

        ${(xgH != null && xgA != null) ? `
          <div style="margin-top:6px;">
            <b>Expected Goals (xG-based λ):</b> ${Number(xgH).toFixed(2)} — ${Number(xgA).toFixed(2)}
          </div>` : ``}

        ${score ? `
          <div style="margin-top:10px;">
            <b>Most likely score:</b> ${escapeHtml(score)}${pScore != null ? ` (p=${(Number(pScore)*100).toFixed(1)}%)` : ``}
          </div>` : ``}

        ${(pHome != null && pDraw != null && pAway != null) ? `
          <div style="margin-top:10px;">
            <b>1X2:</b> Home ${pct(pHome)} | Draw ${pct(pDraw)} | Away ${pct(pAway)}
          </div>` : ``}

        ${lean ? `
          <div style="margin-top:10px;">
            <b>Lean:</b> ${escapeHtml(lean)}
          </div>` : ``}
      </div>
    `;
  }

  async function loadAllData() {
    setStatus("Loading data files…");

    // IMPORTANT: Use RELATIVE paths for GitHub Pages (works in /repo-name/)
    const [teams, league_strength, xg, aliases] = await Promise.all([
      fetchJson("data/teams.json"),
      fetchJson("data/league_strength.json").catch(() => ({})),
      fetchJson("data/xg_2025_2026.json").catch(() => ({})),
      fetchJson("data/aliases.json").catch(() => ({})),
    ]);

    DATA.teams = teams;
    DATA.league_strength = league_strength;
    DATA.xg = xg;
    DATA.aliases = aliases;

    const map = normalizeTeamsJson(teams);
    if (map.size === 0) {
      throw new Error(
        "teams.json loaded, but structure was not recognized.\n\n" +
        "Expected either:\n" +
        "1) { \"League\": [\"Team1\",\"Team2\"] }\n" +
        "or\n" +
        "2) [ { league: \"League\", teams: [\"Team\"] } ]\n" +
        "or\n" +
        "3) [ { league: \"League\", team: \"Team\" } ]"
      );
    }

    STATE.teamsByLeague = map;
    STATE.leagues = uniqSorted(Array.from(map.keys()));

    optionize(leagueEl, STATE.leagues, "Select league");
    enable(leagueEl, true);

    // Start disabled until a league is chosen
    optionize(homeEl, [], "Select home team");
    optionize(awayEl, [], "Select away team");
    enable(homeEl, false);
    enable(awayEl, false);

    setStatus(`Loaded ${STATE.leagues.length} leagues.`);
  }

  function onLeagueChange() {
    const league = leagueEl.value;
    STATE.currentLeague = league;

    if (!league) {
      optionize(homeEl, [], "Select home team");
      optionize(awayEl, [], "Select away team");
      enable(homeEl, false);
      enable(awayEl, false);
      return;
    }

    const teams = STATE.teamsByLeague.get(league) || [];
    optionize(homeEl, teams, "Select home team");
    optionize(awayEl, teams, "Select away team");
    enable(homeEl, true);
    enable(awayEl, true);

    setStatus(`${league}: ${teams.length} teams loaded.`);
  }

  function resetAll() {
    leagueEl.value = "";
    onLeagueChange();
    fixtureEl.value = "";
    simsEl.value = 10000;
    homeAdvEl.value = 1.10;
    baseGoalsEl.value = 1.35;
    goalCapEl.value = 8;
    setResults(`Pick league + teams, then press <b>Run Predictions</b>.`);
    setStatus(STATE.leagues.length ? `Loaded ${STATE.leagues.length} leagues.` : "Ready.");
  }

  async function runPrediction() {
    const league = leagueEl.value;
    const home = homeEl.value;
    const away = awayEl.value;

    if (!league) return setResults(renderError("Missing league", "Please select a league."));
    if (!home) return setResults(renderError("Missing home team", "Please select a home team."));
    if (!away) return setResults(renderError("Missing away team", "Please select an away team."));
    if (home === away) return setResults(renderError("Invalid matchup", "Home and Away teams must be different."));

    const sims = Math.max(1000, Number(simsEl.value || 10000));
    const homeAdv = Number(homeAdvEl.value || 1.10);
    const baseGoals = Number(baseGoalsEl.value || 1.35);
    const goalCap = Math.max(4, Number(goalCapEl.value || 8));

    const payload = {
      league,
      home,
      away,
      sims,
      homeAdv,
      baseGoals,
      goalCap,
      // pass data so engine can use it if it wants
      data: {
        teams: DATA.teams,
        league_strength: DATA.league_strength,
        xg: DATA.xg,
        aliases: DATA.aliases,
      },
    };

    const fn = engineFn();
    if (!fn) {
      return setResults(renderError(
        "Engine not found",
        "engine.js did not expose a prediction function.\n\nExpected one of:\n- window.predictMatchInternal\n- window.predict\n- window.simulateMatch"
      ));
    }

    try {
      setResults(`<div class="card"><div style="opacity:.85;">Running…</div></div>`);
      const out = await fn(payload);

      // If engine returns HTML string
      if (typeof out === "string") {
        setResults(out);
        return;
      }

      // If engine returns an object
      if (out && typeof out === "object") {
        setResults(prettyCard(out));
        return;
      }

      // Fallback
      setResults(renderError("No output from engine", "The engine ran but returned nothing usable."));
    } catch (e) {
      setResults(renderError("Engine error", String(e?.message || e)));
    }
  }

  // Wire events
  leagueEl.addEventListener("change", onLeagueChange);
  runBtn.addEventListener("click", runPrediction);
  resetBtn.addEventListener("click", resetAll);

  // Boot
  (async function init() {
    try {
      enable(leagueEl, false);
      enable(homeEl, false);
      enable(awayEl, false);
      enable(fixtureEl, false);

      await loadAllData();
      setResults(`Pick league + teams, then press <b>Run Predictions</b>.`);
    } catch (e) {
      setResults(renderError("Startup failed", String(e?.message || e)));
      setStatus("Load failed.");
    }
  })();
})();
