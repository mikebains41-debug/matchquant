/* MatchQuant App - loads data + wires UI */

(async function () {
  const $ = (id) => document.getElementById(id);

  const leagueSelect = $("leagueSelect");
  const homeSelect = $("homeSelect");
  const awaySelect = $("awaySelect");
  const homeAdv = $("homeAdv");
  const baseGoals = $("baseGoals");
  const goalCap = $("goalCap");
  const ahSide = $("ahSide");
  const ahLine = $("ahLine");
  const ahOdds = $("ahOdds");
  const runBtn = $("runBtn");
  const results = $("results");
  const status = $("status");

  function setStatus(msg) {
    status.textContent = msg || "";
  }

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  // DATA (your repo already has these)
  let TEAMS = null;            // data/teams.json
  let XG = null;               // data/xg_2025_2026.json
  let LEAGUE_STRENGTH = null;  // data/league_strength.json
  let ALIASES = null;          // data/aliases.json

  function normalizeTeamName(name) {
    if (!name) return name;
    if (ALIASES && ALIASES[name]) return ALIASES[name];
    return name;
  }

  function getLeagueNames() {
    // IMPORTANT: league names are KEYS in teams.json
    // This prevents the “0,1,2…” bug.
    if (!TEAMS || typeof TEAMS !== "object") return [];
    return Object.keys(TEAMS);
  }

  function fillSelect(select, items, placeholder = null) {
    select.innerHTML = "";
    if (placeholder) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    for (const it of items) {
      const opt = document.createElement("option");
      opt.value = it;
      opt.textContent = it;
      select.appendChild(opt);
    }
  }

  function getTeamsForLeague(leagueName) {
    const arr = TEAMS?.[leagueName];
    if (!Array.isArray(arr)) return [];
    // ensure strings, unique, sorted
    return [...new Set(arr.map(String))].sort((a, b) => a.localeCompare(b));
  }

  function leagueMultiplier(leagueName) {
    if (!LEAGUE_STRENGTH || typeof LEAGUE_STRENGTH !== "object") return 1.0;
    const v = LEAGUE_STRENGTH[leagueName];
    const n = Number(v);
    return Number.isFinite(n) ? n : 1.0;
  }

  function xgForTeam(leagueName, teamName) {
    // Supports either:
    // XG[league][team] = { xGF: n, xGA: n } OR { xg: n } OR number
    if (!XG || typeof XG !== "object") return { xGF: null, xGA: null };

    const leagueObj = XG[leagueName];
    if (!leagueObj) return { xGF: null, xGA: null };

    const t = normalizeTeamName(teamName);
    const row = leagueObj[t] || leagueObj[teamName];
    if (row == null) return { xGF: null, xGA: null };

    if (typeof row === "number") return { xGF: row, xGA: null };

    if (typeof row === "object") {
      const xGF = Number.isFinite(Number(row.xGF)) ? Number(row.xGF)
               : Number.isFinite(Number(row.xg)) ? Number(row.xg)
               : Number.isFinite(Number(row.for)) ? Number(row.for)
               : null;

      const xGA = Number.isFinite(Number(row.xGA)) ? Number(row.xGA)
               : Number.isFinite(Number(row.against)) ? Number(row.against)
               : null;

      return { xGF, xGA };
    }

    return { xGF: null, xGA: null };
  }

  function renderResultCard(out) {
    const pct = (p) => `${(p * 100).toFixed(1)}%`;
    const odds = (o) => (o ? o.toFixed ? o.toFixed(2) : o : "—");

    const top = out.mostLikely;
    const score = `${top.h}-${top.a}`;

    const ahBlock = out.ah
      ? `<div style="margin-top:10px;">
          <b>AH (${out.ahSide || ""} ${out.ahLine || ""}) Cover:</b>
          ${pct(out.ah.win)} (Fair ${odds(out.ah.fairOdds)})
          ${Number.isFinite(out.ah.edge) ? `<div style="opacity:.85;margin-top:6px;"><b>Edge (fairProb - bookProb):</b> ${out.ah.edge}</div>` : ""}
        </div>`
      : "";

    return `
      <div class="card" style="padding:16px;">
        <div style="font-size:1.1rem;font-weight:800;">
          ${out.leagueName}: ${out.homeTeam} vs ${out.awayTeam}
        </div>

        <div style="margin-top:10px;">
          <b>Expected Goals (xG-based λ):</b> ${out.lamH.toFixed(2)} – ${out.lamA.toFixed(2)}
        </div>

        <div style="margin-top:10px;">
          <b>Most likely score:</b> ${score} (p=${pct(top.p)})
        </div>

        <div style="margin-top:10px;">
          <b>1X2:</b>
          Home ${pct(out.x12.home)} |
          Draw ${pct(out.x12.draw)} |
          Away ${pct(out.x12.away)}
        </div>

        <div style="margin-top:10px;">
          <b>O/U 2.5:</b>
          Over ${pct(out.ou25.over)} (Fair ${odds(out.ou25.overOdds)}) |
          Under ${pct(out.ou25.under)} (Fair ${odds(out.ou25.underOdds)})
        </div>

        <div style="margin-top:10px;">
          <b>BTTS:</b>
          Yes ${pct(out.btts.yes)} (Fair ${odds(out.btts.yesOdds)}) |
          No ${pct(out.btts.no)} (Fair ${odds(out.btts.noOdds)})
        </div>

        ${ahBlock}

        <div style="margin-top:12px;opacity:.75;">
          League multiplier: ${leagueMultiplier(out.leagueName).toFixed(2)}
        </div>
      </div>
    `;
  }

  function syncTeamDropdowns() {
    const league = leagueSelect.value;
    const teams = getTeamsForLeague(league);

    fillSelect(homeSelect, teams, "Choose home");
    fillSelect(awaySelect, teams, "Choose away");

    // default pick if available
    if (teams.length >= 2) {
      homeSelect.value = teams[0];
      awaySelect.value = teams[1];
    }
  }

  async function init() {
    try {
      setStatus("Loading data…");

      // load in parallel
      const [teams, xg, strength, aliases] = await Promise.all([
        fetchJSON("data/teams.json"),
        fetchJSON("data/xg_2025_2026.json"),
        fetchJSON("data/league_strength.json"),
        fetchJSON("data/aliases.json")
      ]);

      TEAMS = teams;
      XG = xg;
      LEAGUE_STRENGTH = strength;
      ALIASES = aliases;

      const leagues = getLeagueNames().sort((a, b) => a.localeCompare(b));
      fillSelect(leagueSelect, leagues, "Choose league");

      // pick first league by default
      if (leagues.length) {
        leagueSelect.value = leagues[0];
        syncTeamDropdowns();
      }

      leagueSelect.addEventListener("change", syncTeamDropdowns);

      runBtn.addEventListener("click", () => {
        const leagueName = leagueSelect.value;
        const homeTeam = homeSelect.value;
        const awayTeam = awaySelect.value;

        if (!leagueName || !homeTeam || !awayTeam) {
          results.textContent = "Please choose league, home team, and away team.";
          return;
        }
        if (homeTeam === awayTeam) {
          results.textContent = "Home and away teams must be different.";
          return;
        }

        const mult = leagueMultiplier(leagueName);

        const hxg = xgForTeam(leagueName, homeTeam);
        const axg = xgForTeam(leagueName, awayTeam);

        // Use xGF if available, else null (engine will blend with base goals)
        const xgHome = Number.isFinite(hxg.xGF) ? hxg.xGF : null;
        const xgAway = Number.isFinite(axg.xGF) ? axg.xGF : null;

        const ha = Number(homeAdv.value);
        const bg = Number(baseGoals.value);
        const cap = Number(goalCap.value);

        const lineVal = ahLine.value === "none" ? null : Number(ahLine.value);
        const oddsVal = ahOdds.value ? Number(ahOdds.value) : null;

        const payload = {
          leagueName,
          homeTeam,
          awayTeam,
          xgHome,
          xgAway,
          leagueMult: mult,
          homeAdv: Number.isFinite(ha) ? ha : 1.1,
          baseGoals: Number.isFinite(bg) ? bg : 1.35,
          goalCap: Number.isFinite(cap) ? cap : 8,
          ahSide: ahSide.value || "home",
          ahLine: Number.isFinite(lineVal) ? lineVal : null,
          ahOdds: Number.isFinite(oddsVal) ? oddsVal : null
        };

        const out = window.MQ.predictMatchInternal(payload);
        // store for render (optional)
        out.ahSide = payload.ahSide;
        out.ahLine = payload.ahLine;

        results.innerHTML = renderResultCard(out);
      });

      setStatus("Loaded ✅");
    } catch (e) {
      console.error(e);
      setStatus("Load failed ❌");
      results.textContent = String(e?.message || e);
    }
  }

  init();
})();
