/* MatchQuant app.js — FIX teams dropdown on Android + correct IDs
   Uses: leagueSelect, homeTeam, awayTeam, runBtn, results, sims, statusLine
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

  async function loadTeams() {
    // teams.json is in /data
    const res = await fetch("./data/teams.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`teams.json failed (${res.status})`);
    return await res.json();
  }

  function findEngine() {
    // Your engine exposes window.MQ.predictMatchInternal
    if (window.MQ && typeof window.MQ.predictMatchInternal === "function") {
      return window.MQ.predictMatchInternal;
    }
    // fallback if you later expose these
    return window.predictMatch || window.simulateMatch || window.predict;
  }

  function wireLeagueUpdate(updateTeams) {
    // Android select sometimes misses "change" — use multiple signals
    ["change", "input", "blur", "focusout"].forEach((ev) => {
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
        throw new Error("Missing HTML IDs. Check index.html IDs.");
      }

      resetSelect(el.league, "Select league", true);
      resetSelect(el.home, "Select home team", true);
      resetSelect(el.away, "Select away team", true);

      status("Loading teams…");
      setResults(`<div style="opacity:.75">Loading leagues…</div>`);

      const teamsByLeague = await loadTeams();
      const leagues = Object.keys(teamsByLeague).sort();
      if (!leagues.length) throw new Error("teams.json loaded but has no leagues");

      // Fill leagues
      resetSelect(el.league, "Select league", false);
      leagues.forEach((lg) => el.league.appendChild(opt(lg, lg)));
      el.league.disabled = false;

      const updateTeams = () => {
        const league = el.league.value;

        resetSelect(el.home, "Select home team", true);
        resetSelect(el.away, "Select away team", true);

        if (!league) {
          status("Pick a league.");
          return;
        }

        const teams = teamsByLeague[league];
        if (!Array.isArray(teams) || teams.length === 0) {
          status(`No teams found for ${league}`);
          return;
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

        if (!league) return setResults(`<div class="card">Pick a league first.</div>`);
        if (!home || !away) return setResults(`<div class="card">Pick both teams.</div>`);
        if (home === away) return setResults(`<div class="card">Teams must be different.</div>`);

        const engine = findEngine();
        if (typeof engine !== "function") {
          return setResults(`
            <div class="card">
              <b>Run button works ✅</b><br><br>
              But engine.js isn’t exposing a callable function.<br>
              Expected: <code>window.MQ.predictMatchInternal</code>
            </div>
          `);
        }

        // Note: engine.js expects leagueName/homeTeam/awayTeam
        const payload = {
          leagueName: league,
          homeTeam: home,
          awayTeam: away,
          sims: Number(el.sims?.value || 10000),
          // you can wire these later if you want:
          // homeAdv: Number(document.getElementById("homeAdv")?.value || 1.1),
          // baseGoals: Number(document.getElementById("baseGoals")?.value || 1.35),
          // goalCap: Number(document.getElementById("goalCap")?.value || 8),
        };

        try {
          const out = engine(payload);
          setResults(
            typeof out === "string"
              ? out
              : `<pre style="white-space:pre-wrap">${JSON.stringify(out, null, 2)}</pre>`
          );
        } catch (e) {
          setResults(`<div class="card">Engine error: ${e.message}</div>`);
        }
      });

      status(`Loaded ${leagues.length} leagues. Select one.`);
      setResults(`<div style="opacity:.85">Ready. Select league + teams, then Run.</div>`);

      // debug
      window.__teamsByLeague = teamsByLeague;
    } catch (e) {
      console.error(e);
      status("App error");
      setResults(`<div class="card"><b>Error:</b> ${String(e.message || e)}</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```0
