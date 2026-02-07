/* app.js — MatchQuant (home/away xG splits + safe league avg fallback + cards/corners) */
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

  // normalize for alias lookups
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
    if (window.MQ && typeof window.MQ.predictMatchInternal === "function") {
      return window.MQ.predictMatchInternal;
    }
    return null;
  }

  // Android fix: wire multiple events
  function wireLeagueUpdate(updateTeams) {
    ["change", "input", "click", "touchend"].forEach((ev) => {
      el.league?.addEventListener(ev, () => {
        setTimeout(updateTeams, 0);
        setTimeout(updateTeams, 50);
        setTimeout(updateTeams, 150);
      });
    });
  }

  function applyAlias(aliasesByLeague, league, teamName) {
    const leagueAliases = aliasesByLeague?.[league];
    if (!leagueAliases) return teamName;
    const key = norm(teamName);
    return leagueAliases[key] || teamName;
  }

  // --- league-level fallback averages ---
  function leagueAverages(xgTables, league, baseGoals = 1.35) {
    const table = xgTables?.[league];
    if (!table || typeof table !== "object") {
      return { xg: baseGoals, xga: baseGoals };
    }

    let sxg = 0,
      sxga = 0,
      n = 0;

    for (const [team, row] of Object.entries(table)) {
      if (!row || team.startsWith("__")) continue;

      const xg = Number(row.xg);
      const xga = Number(row.xga);

      if (Number.isFinite(xg) && Number.isFinite(xga)) {
        sxg += xg;
        sxga += xga;
        n += 1;
      }
    }

    if (!n) return { xg: baseGoals, xga: baseGoals };
    return { xg: sxg / n, xga: sxga / n };
  }

  // --- safe resolver: team → league avg → base ---
  function safeOverallOrLeagueAvg(xgTables, league, team, baseGoals = 1.35) {
    const row = xgTables?.[league]?.[team];
    const xg = Number(row?.xg);
    const xga = Number(row?.xga);

    if (Number.isFinite(xg) && Number.isFinite(xga)) {
      return { xg, xga };
    }
    return leagueAverages(xgTables, league, baseGoals);
  }

  // split table format: { home_xg, home_xga, away_xg, away_xga }
  function getSplit(xgSplits, league, team) {
    const row = xgSplits?.[league]?.[team];
    if (!row) return null;

    const home_xg = Number(row.home_xg);
    const home_xga = Number(row.home_xga);
    const away_xg = Number(row.away_xg);
    const away_xga = Number(row.away_xga);

    const ok =
      Number.isFinite(home_xg) &&
      Number.isFinite(home_xga) &&
      Number.isFinite(away_xg) &&
      Number.isFinite(away_xga);

    return ok ? { home_xg, home_xga, away_xg, away_xga } : null;
  }

  // cards/corners row format:
  // { cards_for, cards_against, corners_for, corners_against, d4? }
  function getCardsCorners(cardsCorners, league, team) {
    const row = cardsCorners?.[league]?.[team];
    if (!row) return null;

    const cards_for = Number(row.cards_for);
    const cards_against = Number(row.cards_against);
    const corners_for = Number(row.corners_for);
    const corners_against = Number(row.corners_against);

    const ok =
      Number.isFinite(cards_for) &&
      Number.isFinite(cards_against) &&
      Number.isFinite(corners_for) &&
      Number.isFinite(corners_against);

    return ok
      ? {
          cards_for,
          cards_against,
          corners_for,
          corners_against,
          d4: row.d4,
        }
      : null;
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
        throw new Error("Missing HTML IDs. Make sure index.html IDs match app.js.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      status("Loading data…");
      setResults(`<div style="opacity:.8">Loading…</div>`);

      const teamsByLeague = await fetchJson("./data/teams.json");

      // optional data
      let xgTables = {};
      let xgSplits = {};
      let leagueStrength = {};
      let aliases = {};
      let cardsCorners = {};

      try {
        xgTables = await fetchJson("./data/xg_2025_2026.json");
      } catch {}
      try {
        xgSplits = await fetchJson("./data/xg_home_away_2025_2026.json");
      } catch {}
      try {
        leagueStrength = await fetchJson("./data/league_strength.json");
      } catch {}
      try {
        aliases = await fetchJson("./data/aliases.json");
      } catch {}
      try {
        cardsCorners = await fetchJson("./data/cards_corners_2025_2026.json");
      } catch {}

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
        if (!Array.isArray(teams) || !teams.length) {
          return status(`No teams found for ${league}`);
        }

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

        // aliases
        const aliHome = applyAlias(aliases, league, home);
        const aliAway = applyAlias(aliases, league, away);

        // league multiplier
        let leagueMult = 1.0;
        if (typeof leagueStrength?.[league] === "number") leagueMult = leagueStrength[league];
        else if (typeof xgTables?.[league]?.__league_factor === "number")
          leagueMult = xgTables[league].__league_factor;

        const baseGoals = 1.35;
        const homeAdv = 1.10;
        const goalCap = 8;

        // xG splits first
        const splitH = getSplit(xgSplits, league, aliHome);
        const splitA = getSplit(xgSplits, league, aliAway);

        // SAFE overall fallback (team -> league avg -> base)
        const overallH = safeOverallOrLeagueAvg(xgTables, league, aliHome, baseGoals);
        const overallA = safeOverallOrLeagueAvg(xgTables, league, aliAway, baseGoals);

        // home uses HOME split; away uses AWAY split
        const home_xg = splitH?.home_xg ?? overallH.xg;
        const home_xga = splitH?.home_xga ?? overallH.xga;
        const away_xg = splitA?.away_xg ?? overallA.xg;
        const away_xga = splitA?.away_xga ?? overallA.xga;

        // convert to multipliers around base
        const H_att = clamp(home_xg / baseGoals, 0.6, 1.8);
        const H_def = clamp(home_xga / baseGoals, 0.6, 1.8);
        const A_att = clamp(away_xg / baseGoals, 0.6, 1.8);
        const A_def = clamp(away_xga / baseGoals, 0.6, 1.8);

        const xgHome = baseGoals * H_att * A_def;
        const xgAway = baseGoals * A_att * H_def;

        // Cards & Corners (C,D1,D2,D3) — blend rule
        const ccH = getCardsCorners(cardsCorners, league, aliHome);
        const ccA = getCardsCorners(cardsCorners, league, aliAway);

        const cardsHome = ccH && ccA ? (ccH.cards_for + ccA.cards_against) / 2 : null;
        const cardsAway = ccH && ccA ? (ccA.cards_for + ccH.cards_against) / 2 : null;

        const cornersHome = ccH && ccA ? (ccH.corners_for + ccA.corners_against) / 2 : null;
        const cornersAway = ccH && ccA ? (ccA.corners_for + ccH.corners_against) / 2 : null;

        const out = engine({
          leagueName: league,
          homeTeam: home,
          awayTeam: away,
          xgHome,
          xgAway,
          leagueMult,
          homeAdv,
          baseGoals,
          goalCap,
          sims: Number(el.sims?.value || 10000),
        });

        const x12 = out.x12 || {};
        const ou = out.ou25 || {};
        const btts = out.btts || {};
        const ml = out.mostLikely || {};

        setResults(`
          <div style="font-size:18px;font-weight:800;margin-bottom:6px;">
            ${home} vs ${away}
          </div>
          <div style="opacity:.85;margin-bottom:10px;">
            ${league} • λH=${out.lamH.toFixed(2)} • λA=${out.lamA.toFixed(2)}
          </div>

          <div class="kv">
            <span class="badge"><b>Most likely</b>: ${ml.h}-${ml.a} (${toPct(ml.p)})</span>
            <span class="badge"><b>O2.5</b>: ${toPct(ou.over)} (fair ${fairOdds(ou.over)})</span>
            <span class="badge"><b>U2.5</b>: ${toPct(ou.under)} (fair ${fairOdds(ou.under)})</span>
            <span class="badge"><b>BTTS Yes</b>: ${toPct(btts.yes)} (fair ${fairOdds(btts.yes)})</span>
            <span class="badge"><b>BTTS No</b>: ${toPct(btts.no)} (fair ${fairOdds(btts.no)})</span>
          </div>

          <hr style="border:0;border-top:1px solid rgba(255,255,255,.08);margin:12px 0;">

          <div style="font-weight:800;margin-bottom:6px;">1X2 (model)</div>
          <div style="line-height:1.6;">
            Home: <b>${toPct(x12.home)}</b> (fair <b>${fairOdds(x12.home)}</b>)<br>
            Draw: <b>${toPct(x12.draw)}</b> (fair <b>${fairOdds(x12.draw)}</b>)<br>
            Away: <b>${toPct(x12.away)}</b> (fair <b>${fairOdds(x12.away)}</b>)
          </div>

          <hr style="border:0;border-top:1px solid rgba(255,255,255,.08);margin:12px 0;">

          <div style="font-weight:800;margin-bottom:6px;">Cards & Corners (model)</div>
          <div style="line-height:1.6;">
            Cards: Home <b>${fmtNum(cardsHome, 2)}</b> • Away <b>${fmtNum(cardsAway, 2)}</b><br>
            Corners: Home <b>${fmtNum(cornersHome, 2)}</b> • Away <b>${fmtNum(cornersAway, 2)}</b>
          </div>

          <div style="margin-top:12px;opacity:.75;font-size:12px;">
            Splits used: Home(${splitH ? "home split" : "overall/league avg"}) • Away(${splitA ? "away split" : "overall/league avg"})
            <br/>Raw xG used: H xg=${home_xg.toFixed(2)} xga=${home_xga.toFixed(2)} • A xg=${away_xg.toFixed(2)} xga=${away_xga.toFixed(2)}
            <br/>Cards/Corners: ${ccH && ccA ? "team rows found ✅" : "missing rows (check team names/aliases) ⚠️"}
          </div>
        `);

        status("Done.");
      });

      status("Ready. Select league + teams, then Run.");
      setResults(`<div style="opacity:.85">Pick league + teams, then press <b>Run Prediction</b>.</div>`);
    } catch (e) {
      console.error(e);
      status("App error");
      setResults(`<b>Error:</b> ${String(e.message || e)}`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```0
