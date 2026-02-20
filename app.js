/* app.js — MatchQuant (stable dropdowns + robust GitHub Pages data loading)
   - Fixes mobile dropdown population
   - Fixes data fetch path issues on GitHub Pages
   - Never hard-fails if optional files are missing
   - Debug overlay shows exactly what loaded
*/

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

  // Bump this whenever you want to force-refresh data/scripts
  const VERSION = "5";

  // -------------------------
  // UI helpers
  // -------------------------
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

  // -------------------------
  // Debug overlay (mobile-friendly)
  // -------------------------
  const DBG_ID = "mq_debug_box";
  function dbgEnsure() {
    let box = document.getElementById(DBG_ID);
    if (box) return box;

    box = document.createElement("div");
    box.id = DBG_ID;
    box.style.cssText = `
      position: fixed; left: 10px; right: 10px; bottom: 10px;
      z-index: 999999; max-height: 42vh; overflow: auto;
      background: rgba(0,0,0,.78);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 14px; padding: 10px;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #e9eefc;
      box-shadow: 0 12px 30px rgba(0,0,0,.35);
    `;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <b>MatchQuant Debug</b>
        <button id="mq_dbg_close" style="border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e9eefc;border-radius:10px;padding:6px 10px">Hide</button>
      </div>
      <div id="mq_dbg_lines" style="margin-top:8px;white-space:pre-wrap"></div>
    `;
    document.body.appendChild(box);
    box.querySelector("#mq_dbg_close").onclick = () => (box.style.display = "none");
    return box;
  }

  function dbgClear() {
    const box = dbgEnsure();
    box.querySelector("#mq_dbg_lines").textContent = "";
  }

  function dbg(msg) {
    const box = dbgEnsure();
    const lines = box.querySelector("#mq_dbg_lines");
    const ts = new Date().toLocaleTimeString();
    lines.textContent = `${lines.textContent}${lines.textContent ? "\n" : ""}[${ts}] ${msg}`;
  }

  // -------------------------
  // Data loading (THIS fixes your xg_tables.json “missing/failed”)
  // -------------------------
  function withVersion(url) {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}v=${encodeURIComponent(VERSION)}`;
  }

  // GitHub Pages can be served from /matchquant/ so we build base paths safely.
  function candidateUrls(relPath) {
    const clean = relPath.replace(/^\/+/, "");

    // Example:
    // location.origin = https://mikebains41-debug.github.io
    // location.pathname = /matchquant/   (or /matchquant/index.html)
    const origin = location.origin;
    const path = location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname.substring(0, location.pathname.lastIndexOf("/") + 1);

    return [
      withVersion(`./${clean}`),                 // ./data/teams.json
      withVersion(`${path}${clean}`),            // /matchquant/data/teams.json
      withVersion(`${origin}${path}${clean}`),   // https://.../matchquant/data/teams.json
      withVersion(`/${clean}`),                  // /data/teams.json (sometimes works)
    ];
  }

  async function fetchJsonSmart(relPath) {
    const urls = candidateUrls(relPath);
    let lastErr = null;

    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          lastErr = new Error(`${url} -> ${res.status}`);
          continue;
        }
        const data = await res.json();
        dbg(`Loaded: ${relPath} ✅ (${url})`);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }

    dbg(`FAILED: ${relPath} ❌ (${lastErr ? lastErr.message : "unknown"})`);
    throw lastErr || new Error(`Failed to load ${relPath}`);
  }

  // -------------------------
  // Robust parsing helpers
  // -------------------------
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

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

  function getTeamsForLeague(teamsByLeague, league) {
    const v = teamsByLeague?.[league];
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean).slice().sort();
    if (typeof v === "object") {
      if (Array.isArray(v.teams)) return v.teams.filter(Boolean).slice().sort();
      return Object.keys(v).filter((k) => !String(k).startsWith("__")).sort();
    }
    return [];
  }

  // League averages from xg_tables.json (if present)
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
          sxg += att;
          sxga += def;
          n++;
        }
      }
      out[league] = n ? { xg: sxg / n, xga: sxga / n } : { xg: baseGoals, xga: baseGoals };
    }
    return out;
  }

  function getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, team, baseGoals = 1.35) {
    const row = xgTables?.[league]?.[team];
    const att = Number(row?.att);
    const def = Number(row?.def);
    if (Number.isFinite(att) && Number.isFinite(def)) return { att, def, found: true };
    const avg = leagueXgAvg?.[league] || { xg: baseGoals, xga: baseGoals };
    return { att: avg.xg, def: avg.xga, found: false };
  }

  // Cards/Corners league averages
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
      out[league] = n ? {
        cards_for: scf / n,
        cards_against: sca / n,
        corners_for: sof / n,
        corners_against: soa / n,
      } : null;
    }
    return out;
  }

  function getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, team) {
    const row = cardsCorners?.[league]?.[team];
    const cf = Number(row?.cards_for);
    const ca = Number(row?.cards_against);
    const of = Number(row?.corners_for);
    const oa = Number(row?.corners_against);
    if ([cf, ca, of, oa].every(Number.isFinite)) {
      return { cards_for: cf, cards_against: ca, corners_for: of, corners_against: oa, found: true };
    }
    const avg = leagueCcAvg?.[league];
    if (avg) return { ...avg, found: false };
    return null;
  }

  function findEngine() {
    return window.MQ && typeof window.MQ.predictMatchInternal === "function"
      ? window.MQ.predictMatchInternal
      : null;
  }

  // -------------------------
  // INIT
  // -------------------------
  async function init() {
    try {
      dbgEnsure();
      dbgClear();

      if (!el.league || !el.home || !el.away || !el.runBtn || !el.results) {
        throw new Error("Missing HTML IDs. Make sure index.html uses leagueSelect/homeTeam/awayTeam/sims/runBtn/results/statusLine.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      status("Loading data…");
      setResults(`<div style="opacity:.8">Loading…</div>`);

      // Required
      const teamsByLeague = await fetchJsonSmart("data/teams.json");

      // Optional (app will still run if missing)
      let xgTables = {};
      let leagueStrength = {};
      let cardsCorners = {};

      try { xgTables = await fetchJsonSmart("data/xg_tables.json"); }
      catch { dbg("xg_tables.json missing — using league averages"); }

      try { leagueStrength = await fetchJsonSmart("data/league_strength.json"); }
      catch { dbg("league_strength.json missing — using 1.00"); }

      try { cardsCorners = await fetchJsonSmart("data/cards_corners_2025_2026.json"); }
      catch { dbg("cards_corners_2025_2026.json missing — using defaults"); }

      const baseGoals = 1.35;
      const leagueXgAvg = computeLeagueXgAverages(xgTables, baseGoals);
      const leagueCcAvg = computeLeagueCcAverages(cardsCorners);

      const leagues = Object.keys(teamsByLeague || {}).sort();
      if (!leagues.length) throw new Error("teams.json loaded but no leagues found.");

      // Fill league dropdown
      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      // Stable change handler
      function updateTeams() {
        const league = el.league.value || "";
        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) {
          status("Pick a league.");
          dbg("League empty");
          return;
        }

        const teams = getTeamsForLeague(teamsByLeague, league);
        dbg(`League changed: ${league} -> teams: ${teams.length}`);

        if (!teams.length) {
          status(`No teams found for ${league}`);
          return;
        }

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
        status(`Loaded ${teams.length} teams for ${league}`);
      }

      el.league.addEventListener("change", updateTeams);

      // Run prediction
      el.runBtn.addEventListener("click", () => {
        const league = el.league.value;
        const home = el.home.value;
        const away = el.away.value;

        if (!league) return setResults(`<b>Pick a league first.</b>`);
        if (!home || !away) return setResults(`<b>Pick both teams.</b>`);
        if (home === away) return setResults(`<b>Teams must be different.</b>`);

        const engine = findEngine();
        if (!engine) {
          dbg("Engine NOT found: window.MQ.predictMatchInternal missing");
          return setResults(`<b>Engine not found.</b> Make sure <code>engine.js</code> loads before <code>app.js</code>.`);
        }

        // League multiplier
        let leagueMult = 1.0;
        if (typeof leagueStrength?.[league] === "number") leagueMult = leagueStrength[league];

        // xG inputs (team if exists, else league avg)
        const H = getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, home, baseGoals);
        const A = getTeamXgOrLeagueAvg(xgTables, leagueXgAvg, league, away, baseGoals);

        const H_att = clamp(num(H.att, 1), 0.3, 2.5);
        const H_def = clamp(num(H.def, 1), 0.3, 2.5);
        const A_att = clamp(num(A.att, 1), 0.3, 2.5);
        const A_def = clamp(num(A.def, 1), 0.3, 2.5);

        const xgHome = baseGoals * H_att * A_def;
        const xgAway = baseGoals * A_att * H_def;

        // Cards/Corners inputs (team if exists, else league avg, else fallback)
        const fallbackCC = { cards_for: 2.2, cards_against: 2.2, corners_for: 5.0, corners_against: 5.0 };
        const CC_H = getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, home) || fallbackCC;
        const CC_A = getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, away) || fallbackCC;

        const cardsHome = (num(CC_H.cards_for) + num(CC_A.cards_against)) / 2;
        const cardsAway = (num(CC_A.cards_for) + num(CC_H.cards_against)) / 2;

        const cornersHome = (num(CC_H.corners_for) + num(CC_A.corners_against)) / 2;
        const cornersAway = (num(CC_A.corners_for) + num(CC_H.corners_against)) / 2;

        const sims = parseInt(el.sims?.value || "10000", 10) || 10000;

        const out = engine({
          leagueName: league,
          homeTeam: home,
          awayTeam: away,
          sims,
          xgHome,
          xgAway,
          leagueMult,
          homeAdv: 1.10,
          goalCap: 8,
          cardsHome,
          cardsAway,
          cornersHome,
          cornersAway,
        });

        const most = out.mostLikely;

        setResults(`
          <div class="card">
            <h2>${home} vs ${away}</h2>
            <div style="opacity:.85">${league} • λH=${fmtNum(out.lamH,2)} • λA=${fmtNum(out.lamA,2)}</div>

            <div class="pill">Most likely: ${most.h}-${most.a} (${toPct(most.p)})</div>

            <div class="pill">O2.5: ${toPct(out.ou25.over)} (fair ${fairOdds(out.ou25.over)})</div>
            <div class="pill">U2.5: ${toPct(out.ou25.under)} (fair ${fairOdds(out.ou25.under)})</div>

            <div class="pill">BTTS Yes: ${toPct(out.btts.yes)} (fair ${fairOdds(out.btts.yes)})</div>
            <div class="pill">BTTS No: ${toPct(out.btts.no)} (fair ${fairOdds(out.btts.no)})</div>

            <hr style="opacity:.15;margin:14px 0">

            <h3>1X2 (model)</h3>
            <div>Home: ${toPct(out.x12.home)} (fair ${fairOdds(out.x12.home)})</div>
            <div>Draw: ${toPct(out.x12.draw)} (fair ${fairOdds(out.x12.draw)})</div>
            <div>Away: ${toPct(out.x12.away)} (fair ${fairOdds(out.x12.away)})</div>

            <hr style="opacity:.15;margin:14px 0">

            <h3>Cards & Corners (model)</h3>
            <div style="opacity:.85">Team Cards (inputs): Home ${fmtNum(cardsHome,2)} • Away ${fmtNum(cardsAway,2)}</div>
            <div style="opacity:.85">Team Corners (inputs): Home ${fmtNum(cornersHome,2)} • Away ${fmtNum(cornersAway,2)}</div>

            <div style="margin-top:10px">
              <div>Total Cards λ: <b>${fmtNum(out.cards.lambdaTotal,2)}</b> • Most likely total: <b>${out.cards.mostLikelyTotal.k}</b></div>
              <div>O4.5: ${toPct(out.cards.ou45.over)} (fair ${fairOdds(out.cards.ou45.over)}) •
                   U4.5: ${toPct(out.cards.ou45.under)} (fair ${fairOdds(out.cards.ou45.under)})</div>
            </div>

            <div style="margin-top:10px">
              <div>Total Corners λ: <b>${fmtNum(out.corners.lambdaTotal,2)}</b> • Most likely total: <b>${out.corners.mostLikelyTotal.k}</b></div>
              <div>O9.5: ${toPct(out.corners.ou95.over)} (fair ${fairOdds(out.corners.ou95.over)}) •
                   U9.5: ${toPct(out.corners.ou95.under)} (fair ${fairOdds(out.corners.ou95.under)})</div>
            </div>

            <div style="opacity:.75;margin-top:12px;font-size:.9em">
              xG source: ${H.found && A.found ? "TEAM xG/xGA" : "LEAGUE AVG fallback (xg_tables missing or team not found)"}
            </div>
          </div>
        `);

        status("Done.");
        dbg("Prediction ran OK");
      });

      status("Ready.");
      setResults(`<div style="opacity:.85">Select a league and teams, then press <b>Run Prediction</b>.</div>`);
      dbg(`Leagues found: ${leagues.length}`);
      dbg("App ready");
    } catch (err) {
      console.error(err);
      status("App error");
      setResults(`<b>Error:</b> ${String(err.message || err)}`);
      dbg(`ERROR: ${String(err.message || err)}`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
