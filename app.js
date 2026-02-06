/* app.js — MatchQuant (works with engine.js + ./data/*.json) */
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

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "");

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
      el.league.addEventListener(ev, () => {
        setTimeout(updateTeams, 0);
        setTimeout(updateTeams, 50);
        setTimeout(updateTeams, 150);
      });
    });
  }

  function applyAlias(aliasesByLeague, league, teamName) {
    const leagueAliases = aliasesByLeague?.[league];
    if (!leagueAliases) return teamName;

    // aliases file uses lowercase keys like "man utd"
    const key = norm(teamName);
    return leagueAliases[key] || teamName;
  }

  function getTeamStrength(xgTables, league, team) {
    // supports: {att, def} OR {xg, xga}
    const lg = xgTables?.[league] || {};
    const row = lg?.[team];

    if (!row) return { att: 1.0, def: 1.0, found: false };

    // format A: att/def
    if (row.att != null || row.def != null) {
      return {
        att: Number(row.att ?? 1.0),
        def: Number(row.def ?? 1.0),
        found: true,
      };
    }

    // format B: xg/xga (convert into multipliers around league mean ~1.35)
    if (row.xg != null || row.xga != null) {
      // simple scaling so it behaves like multipliers
      // baseGoals will be multiplied by att and def (def used as opponent multiplier)
      const xg = Number(row.xg ?? 1.35);
      const xga = Number(row.xga ?? 1.35);

      // convert to “multiplier-ish”
      const att = clamp(xg / 1.35, 0.6, 1.6);
      const def = clamp(xga / 1.35, 0.6, 1.6);

      return { att, def, found: true };
    }

    return { att: 1.0, def: 1.0, found: false };
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
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

      // optional
      let xgTables = {};
      let leagueStrength = {};
      let aliases = {};

      try { xgTables = await fetchJson("./data/xg_2025_2026.json"); } catch {}
      try { leagueStrength = await fetchJson("./data/league_strength.json"); } catch {}
      try { aliases = await fetchJson("./data/aliases.json"); } catch {}

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

        // Apply alias mapping
        const aliHome = applyAlias(aliases, league, home);
        const aliAway = applyAlias(aliases, league, away);

        // League multiplier
        let leagueMult = 1.0;
        if (typeof leagueStrength?.[league] === "number") leagueMult = leagueStrength[league];
        else if (typeof xgTables?.[league]?.__league_factor === "number") leagueMult = xgTables[league].__league_factor;

        // Strengths
        const H = getTeamStrength(xgTables, league, aliHome);
        const A = getTeamStrength(xgTables, league, aliAway);

        const baseGoals = 1.35;
        const homeAdv = 1.10;
        const goalCap = 8;

        // Expected goals
        const xgHome = baseGoals * H.att * A.def;
        const xgAway = baseGoals * A.att * H.def;

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
        });

        const x12 = out.x12 || {};
        const ou = out.ou25 || {};
        const btts = out.btts || {};
        const ml = out.mostLikely || {};

        const toPct = (x) => (x * 100).toFixed(1) + "%";
        const fairOdds = (p) => (!p || p <= 0 ? "—" : (1 / p).toFixed(2));

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

          <div style="margin-top:12px;opacity:.75;font-size:12px;">
            Notes: Aliases applied: ${aliHome !== home ? `${home}→${aliHome}` : "none"} •
            ${aliAway !== away ? `${away}→${aliAway}` : "none"} •
            xG rows found: H=${H.found ? "yes" : "no"} A=${A.found ? "yes" : "no"}
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
