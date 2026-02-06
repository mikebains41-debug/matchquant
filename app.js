/* MatchQuant app.js — loads data + wires UI to engine (window.MQ.predictMatchInternal)
   Folder layout expected:
   /app.js
   /engine.js
   /index.html
   /style.css
   /data/teams.json
   /data/xg_2025_2026.json
   /data/league_strength.json   (optional but recommended)
   /data/aliases.json           (optional)
   /h2h.json                    (optional; can also be in /data/h2h.json)
   /fixtures.json               (optional; can also be in /data/fixtures.json)
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
    homeAdv: $("homeAdv"),
    baseGoals: $("baseGoals"),
    goalCap: $("goalCap"),
  };

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

  async function fetchJson(path, opts = {}) {
    const res = await fetch(path, { cache: "no-store", ...opts });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return await res.json();
  }

  // Try multiple locations (lets you keep some files in root or /data)
  async function fetchJsonAny(paths) {
    let lastErr = null;
    for (const p of paths) {
      try {
        return await fetchJson(p);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("fetchJsonAny failed");
  }

  function normalizeKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "");
  }

  function h2hKey(league, home, away) {
    return `${normalizeKey(league)}__${normalizeKey(home)}__${normalizeKey(away)}`;
  }

  function toPct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  function fairOdds(prob) {
    if (!prob || prob <= 0) return null;
    return (1 / prob).toFixed(2);
  }

  function impliedProb(odds) {
    if (!odds || odds <= 1) return null;
    return 1 / odds;
  }

  function findEngine() {
    // Your engine.js exposes window.MQ.predictMatchInternal
    if (window.MQ && typeof window.MQ.predictMatchInternal === "function") {
      return window.MQ.predictMatchInternal;
    }
    // fallback names if you ever change it
    return window.predictMatch || window.simulateMatch || window.predict || null;
  }

  // Android sometimes doesn’t fire "change" reliably; wire multiple events.
  function wireLeagueUpdate(updateTeams) {
    ["change", "input", "click", "touchend"].forEach((ev) => {
      el.league.addEventListener(ev, () => {
        setTimeout(updateTeams, 0);
        setTimeout(updateTeams, 50);
        setTimeout(updateTeams, 150);
      });
    });
  }

  async function init() {
    try {
      if (!el.league || !el.home || !el.away || !el.runBtn || !el.results) {
        throw new Error("Missing HTML IDs. Check index.html IDs match app.js.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      status("Loading data…");
      setResults(`<div style="opacity:.8">Loading…</div>`);

      // REQUIRED
      const teamsByLeague = await fetchJson("./data/teams.json");

      // OPTIONALS (safe if missing)
      let xgTables = {};
      let leagueStrength = {};
      let aliases = {};
      let h2h = {};
      let fixtures = [];

      try {
        xgTables = await fetchJson("./data/xg_2025_2026.json");
      } catch (_) {}

      try {
        leagueStrength = await fetchJson("./data/league_strength.json");
      } catch (_) {}

      try {
        aliases = await fetchJson("./data/aliases.json");
      } catch (_) {}

      try {
        h2h = await fetchJsonAny(["./data/h2h.json", "./h2h.json"]);
      } catch (_) {}

      try {
        fixtures = await fetchJsonAny(["./data/fixtures.json", "./fixtures.json"]);
      } catch (_) {}

      // Fill leagues dropdown
      const leagues = Object.keys(teamsByLeague || {}).sort();
      if (!leagues.length) throw new Error("teams.json loaded but has no leagues.");

      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      // Update teams when league changes
      const updateTeams = () => {
        const league = el.league.value;
        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) {
          status("Pick a league.");
          return;
        }

        const teams = teamsByLeague[league];
        if (!Array.isArray(teams) || !teams.length) {
          status(`No teams found for ${league}`);
          return;
        }

        fillSelect(el.home, teams, "Select home team");
        fillSelect(el.away, teams, "Select away team");
        status(`Loaded ${teams.length} teams for ${league}`);
      };

      wireLeagueUpdate(updateTeams);

      // Run button
      el.runBtn.addEventListener("click", () => {
        const league = el.league.value;
        const home = el.home.value;
        const away = el.away.value;

        if (!league) return setResults(`<b>Pick a league first.</b>`);
        if (!home || !away) return setResults(`<b>Pick both teams.</b>`);
        if (home === away) return setResults(`<b>Teams must be different.</b>`);

        const engine = findEngine();
        if (typeof engine !== "function") {
          return setResults(
            `<b>Engine not found.</b><br>
             Your <code>engine.js</code> must load before <code>app.js</code> and expose:<br>
             <code>window.MQ.predictMatchInternal</code>`
          );
        }

        const baseGoals = Number(el.baseGoals?.value || 1.35);
        const homeAdv = Number(el.homeAdv?.value || 1.10);
        const goalCap = Number(el.goalCap?.value || 8);

        // Apply aliases (optional) so names match xG tables / h2h keys if needed
        const aliLeague = aliases[league] || league;
        const aliHome = (aliases[league]?.[home]) || home;
        const aliAway = (aliases[league]?.[away]) || away;

        // League multiplier
        let leagueMult = 1.0;
        if (leagueStrength && typeof leagueStrength[league] === "number") {
          leagueMult = leagueStrength[league];
        } else if (xgTables && xgTables[league] && typeof xgTables[league].__league_factor === "number") {
          leagueMult = xgTables[league].__league_factor;
        }

        // Derive “xgHome/xgAway” from attack/def strength if available
        // xgTables format: xgTables[league][team] = { att, def }
        const lgBlock = xgTables?.[league] || {};
        const H = lgBlock?.[aliHome] || lgBlock?.[home];
        const A = lgBlock?.[aliAway] || lgBlock?.[away];

        // If missing, just fall back to baseGoals
        const attH = Number(H?.att ?? 1.0);
        const defH = Number(H?.def ?? 1.0);
        const attA = Number(A?.att ?? 1.0);
        const defA = Number(A?.def ?? 1.0);

        // Expected goals inputs
        const xgHome = baseGoals * attH * defA;
        const xgAway = baseGoals * attA * defH;

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

        // H2H lookup (optional)
        const k = h2hKey(aliLeague, aliHome, aliAway);
        const h2hRow = h2h?.[k];

        // Fixture odds (optional)
        let fx = null;
        if (Array.isArray(fixtures)) {
          fx = fixtures.find(
            (r) =>
              normalizeKey(r.league) === normalizeKey(league) &&
              normalizeKey(r.home) === normalizeKey(home) &&
              normalizeKey(r.away) === normalizeKey(away)
          );
        }

        const x12 = out.x12 || {};
        const ou = out.ou25 || {};
        const btts = out.btts || {};
        const ml = out.mostLikely || {};

        const bookH = fx?.odds?.home;
        const bookD = fx?.odds?.draw;
        const bookA = fx?.odds?.away;

        const impH = impliedProb(bookH);
        const impD = impliedProb(bookD);
        const impA = impliedProb(bookA);

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

          ${
            fx?.odds
              ? `<div style="margin-top:10px;opacity:.9;">
                  <div style="font-weight:800;margin-bottom:6px;">Book odds (fixtures.json)</div>
                  Home ${bookH} (imp ${impH ? toPct(impH) : "—"}) •
                  Draw ${bookD} (imp ${impD ? toPct(impD) : "—"}) •
                  Away ${bookA} (imp ${impA ? toPct(impA) : "—"})
                </div>`
              : `<div style="margin-top:10px;opacity:.75;">
                  No matching book odds found in fixtures.json for this matchup.
                </div>`
          }

          ${
            h2hRow
              ? `<div style="margin-top:12px;">
                  <div style="font-weight:800;margin-bottom:6px;">Last H2H</div>
                  ${h2hRow.date}: <b>${h2hRow.score}</b> • Cards: <b>${h2hRow.cards}</b> • Corners: <b>${h2hRow.corners}</b>
                </div>`
              : `<div style="margin-top:12px;opacity:.75;">
                  No H2H record found (check h2h.json key formatting).
                </div>`
          }

          <div style="margin-top:12px;opacity:.65;font-size:12px;">
            Tip: if teams don’t show on Android, tap the league twice or change leagues once then back.
          </div>
        `);

        status("Done. Pick another match or adjust inputs.");
      });

      status("Ready. Select league + teams, then Run.");
      setResults(`<div style="opacity:.85">Pick league + teams, then press <b>Run Predictions</b>.</div>`);

      // debug
      window.__MQ = { teamsByLeague, xgTables, leagueStrength, aliases };
    } catch (e) {
      console.error(e);
      status("App error");
      setResults(`<b>Error:</b> ${String(e.message || e)}`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
