/* app.js — MatchQuant (FIXED: xG + Cards + Corners + loading diagnostics) */
(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    league: $("leagueSelect"),
    home: $("homeTeam"),
    away: $("awayTeam"),
    sims: $("sims"),
    runBtn: $("runBtn"),
    results: $("results"),
    status: $("statusLine"),
  };

  // -------------------------
  // helpers
  // -------------------------
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "")
      .replace(/[.]/g, "");

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function status(msg) {
    if (el.status) el.status.textContent = msg;
  }

  function setResults(html) {
    if (el.results) el.results.innerHTML = html;
  }

  function opt(v, t) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
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
    sel.disabled = false;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return await res.json();
  }

  function findEngine() {
    return window.MQ && typeof window.MQ.predictMatchInternal === "function"
      ? window.MQ.predictMatchInternal
      : null;
  }

  function wireLeagueUpdate(updateTeams) {
    ["change", "input", "click", "touchend"].forEach((ev) => {
      el.league?.addEventListener(ev, () => {
        setTimeout(updateTeams, 0);
        setTimeout(updateTeams, 60);
        setTimeout(updateTeams, 160);
      });
    });
  }

  function applyAlias(aliasesByLeague, league, teamName) {
    const leagueAliases = aliasesByLeague?.[league];
    if (!leagueAliases) return teamName;
    const key = norm(teamName);
    return leagueAliases[key] || teamName;
  }

  // ----------------------------------------
  // Resolve team key against ANY table:
  // exact -> alias -> normalized scan
  // tableByLeague = { [league]: { [teamKey]: row, ... } }
  // ----------------------------------------
  function resolveTeamKeyAny(tableByLeague, aliases, league, teamName) {
    const table = tableByLeague?.[league];
    if (!table || typeof table !== "object") return teamName;

    if (table[teamName]) return teamName;

    const ali = applyAlias(aliases, league, teamName);
    if (ali && table[ali]) return ali;

    const nt = norm(teamName);
    for (const k of Object.keys(table)) {
      if (String(k).startsWith("__")) continue;
      if (norm(k) === nt) return k;
    }
    return teamName;
  }

  // -------------------------
  // xG league averages
  // -------------------------
  function computeLeagueXgAverages(xgTables, baseGoals = 1.35) {
    const out = {};
    for (const [league, table] of Object.entries(xgTables || {})) {
      if (!table || typeof table !== "object") continue;

      let sxg = 0, sxga = 0, n = 0;
      for (const [team, row] of Object.entries(table)) {
        if (!row || String(team).startsWith("__")) continue;
        const att = Number(row.att);
        const def = Number(row.def);
        if (Number.isFinite(att) && Number.isFinite(def)) {
          sxg += att; sxga += def; n++;
        }
      }
      out[league] = n ? { xg: sxg / n, xga: sxga / n } : { xg: baseGoals, xga: baseGoals };
    }
    return out;
  }

  function getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, teamKey, baseGoals = 1.35) {
    const row = xgTables?.[league]?.[teamKey];
    const att = Number(row?.att);
    const def = Number(row?.def);

    if (Number.isFinite(att) && Number.isFinite(def)) return { att, def, found: true };

    const avg = leagueXgAvg?.[league] || { xg: baseGoals, xga: baseGoals };
    return { att: avg.xg, def: avg.xga, found: false };
  }

  // -------------------------
  // Cards/Corners league averages
  // cardsCorners row: { cards_for, cards_against, corners_for, corners_against }
  // -------------------------
  function computeLeagueCcAverages(cardsCorners) {
    const out = {};
    for (const [league, table] of Object.entries(cardsCorners || {})) {
      if (!table || typeof table !== "object") continue;

      let scf = 0, sca = 0, sof = 0, soa = 0, n = 0;
      for (const [team, row] of Object.entries(table)) {
        if (!row || String(team).startsWith("__")) continue;
        const cf = Number(row.cards_for);
        const ca = Number(row.cards_against);
        const of = Number(row.corners_for);
        const oa = Number(row.corners_against);

        if ([cf, ca, of, oa].every(Number.isFinite)) {
          scf += cf; sca += ca; sof += of; soa += oa; n++;
        }
      }

      out[league] = n
        ? { cards_for: scf / n, cards_against: sca / n, corners_for: sof / n, corners_against: soa / n }
        : null;
    }
    return out;
  }

  function getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, teamKey) {
    const row = cardsCorners?.[league]?.[teamKey];
    const cf = Number(row?.cards_for);
    const ca = Number(row?.cards_against);
    const of = Number(row?.corners_for);
    const oa = Number(row?.corners_against);

    if ([cf, ca, of, oa].every(Number.isFinite)) {
      return { cards_for: cf, cards_against: ca, corners_for: of, corners_against: oa, found: true };
    }

    const avg = leagueCcAvg?.[league];
    if (avg) return { ...avg, found: false };

    return null; // no data at all for that league
  }

  function fmtNum(x, d = 2) {
    if (x == null || !Number.isFinite(Number(x))) return "—";
    return Number(x).toFixed(d);
  }

  function toPct(x) {
    if (x == null || !Number.isFinite(Number(x))) return "—";
    return (Number(x) * 100).toFixed(1) + "%";
  }

  function fairOdds(p) {
    const pp = Number(p);
    if (!pp || !Number.isFinite(pp) || pp <= 0) return "—";
    return (1 / pp).toFixed(2);
  }

  async function init() {
    try {
      if (!el.league || !el.home || !el.away || !el.runBtn || !el.results) {
        throw new Error("Missing HTML IDs. index.html IDs must match app.js.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      status("Loading data…");
      setResults(`<div style="opacity:.8">Loading…</div>`);

      // IMPORTANT: if this fails, your dropdowns will be empty.
      const teamsByLeague = await fetchJson("./data/teams.json");

      let xgTables = {};
      let leagueStrength = {};
      let aliases = {};
      let cardsCorners = {};

      try { xgTables = await fetchJson("./data/xg_tables.json"); } catch (e) { console.warn("xg_tables.json missing", e); }
      try { leagueStrength = await fetchJson("./data/league_strength.json"); } catch {}
      try { aliases = await fetchJson("./data/aliases.json"); } catch {}
      try { cardsCorners = await fetchJson("./data/cards_corners_2025_2026.json"); } catch (e) { console.warn("cards/corners missing", e); }

      const baseGoals = 1.35;
      const leagueXgAvg = computeLeagueXgAverages(xgTables, baseGoals);
      const leagueCcAvg = computeLeagueCcAverages(cardsCorners);

      const leagues = Object.keys(teamsByLeague || {}).sort();
      if (!leagues.length) throw new Error("teams.json loaded but has no leagues");

      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      const updateTeams = () => {
        const league = el.league.value;

        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) return status("Pick a league.");

        const teams = teamsByLeague[league];
        if (!Array.isArray(teams) || !teams.length) return status(`No teams found for ${league}`);

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
        status(`Loaded ${teams.length} teams for ${league}`);
      };

      wireLeagueUpdate(updateTeams);

      el.runBtn.addEventListener("click", () => {
        const league = el.league.value;
        const home = el.home.value;
        const away = el.away.value;

        if (!league) return setResults(`<b>Pick a league first.</b>`);
        if (!home || !away) return setResults(`<b>Pick both teams.</b>`);
        if (home === away) return setResults(`<b>Teams must be different.</b>`);

        const engine = findEngine();
        if (!engine) {
          return setResults(
            `<b>Engine not found.</b><br>
             Make sure <code>engine.js</code> loads before <code>app.js</code> and exposes:<br>
             <code>window.MQ.predictMatchInternal</code>`
          );
        }

        // Resolve keys per dataset
        const xgHomeKey = resolveTeamKeyAny(xgTables, aliases, league, home);
        const xgAwayKey = resolveTeamKeyAny(xgTables, aliases, league, away);

        const ccHomeKey = resolveTeamKeyAny(cardsCorners, aliases, league, home);
        const ccAwayKey = resolveTeamKeyAny(cardsCorners, aliases, league, away);

        // League multiplier
        let leagueMult = 1.0;
        if (typeof leagueStrength?.[league] === "number") leagueMult = leagueStrength[league];
        else if (typeof xgTables?.[league]?.__league_factor === "number")
          leagueMult = xgTables[league].__league_factor;

        const homeAdv = 1.10;
        const goalCap = 8;

        // xG values (team or league avg)
        const H = getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, xgHomeKey, baseGoals);
        const A = getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, xgAwayKey, baseGoals);

        const H_att = clamp
