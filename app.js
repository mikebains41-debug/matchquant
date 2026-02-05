/* MatchQuant app.js
   - Loads fixtures.json, xg_tables.json, h2h.json
   - Wires selects + Run Prediction
   - Uses custom modal so it says "MatchQuant says" (NOT site URL)
*/

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    league: $("leagueSelect"),
    fixture: $("fixtureSelect"),
    home: $("homeSelect"),
    away: $("awaySelect"),
    sims: $("simsInput"),
    homeAdv: $("homeAdvInput"),
    baseGoals: $("baseGoalsInput"),
    capGoals: $("capGoalsInput"),
    leagueFactor: $("leagueFactorInput"), // optional if exists
    evThresh: $("evThreshInput"),         // optional if exists
    runBtn: $("runBtn"),

    statusFixtures: $("statusFixtures"),
    statusXg: $("statusXg"),
    statusH2H: $("statusH2H"),
    readyLine: $("readyLine"),
    outCard: $("outCard"),
    fixturesTableBody: $("fixturesTableBody"),
  };

  // ---------------- Modal (replaces alert) ----------------
  function ensureModal() {
    if (document.getElementById("mqModal")) return;

    const wrap = document.createElement("div");
    wrap.id = "mqModal";
    wrap.style.cssText = `
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55); z-index: 9999; padding: 16px;
    `;

    wrap.innerHTML = `
      <div style="
        width: min(720px, 95vw);
        max-height: 80vh;
        overflow: auto;
        background: #0b1b3a;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.55);
        padding: 16px 16px 14px 16px;
        color: #fff;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      ">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="font-size: 20px; font-weight: 800;">MatchQuant says</div>
          <button id="mqClose" style="
            background:#2b66ff; color:#fff; border:none; border-radius:12px;
            padding:10px 14px; font-weight:700; cursor:pointer;
          ">OK</button>
        </div>
        <pre id="mqBody" style="
          margin-top: 12px;
          white-space: pre-wrap;
          word-wrap: break-word;
          line-height: 1.35;
          font-size: 15px;
          opacity: 0.98;
        "></pre>
      </div>
    `;

    document.body.appendChild(wrap);

    const close = () => (wrap.style.display = "none");
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close();
    });
    document.getElementById("mqClose").addEventListener("click", close);
  }

  function showModal(text) {
    ensureModal();
    const wrap = document.getElementById("mqModal");
    const body = document.getElementById("mqBody");
    body.textContent = text || "";
    wrap.style.display = "flex";
  }

  // ---------------- Status UI ----------------
  function setStatus(el, ok, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("bad", !ok);
  }

  function clearSelect(sel, placeholder) {
    if (!sel) return;
    sel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    sel.appendChild(opt);
    sel.value = "";
  }

  function fillSelect(sel, items, placeholder) {
    clearSelect(sel, placeholder);
    for (const v of items) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
  }

  function uniqSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  }

  // ---------------- Data state ----------------
  let xgRaw = null;
  let fixturesRaw = null;
  let h2hRaw = null;

  let fixtures = []; // {id, league, home, away, date?, odds?}
  let leagues = [];
  let teamsByLeague = new Map();

  let currentLeague = "";
  let currentFixtureId = "";
  let currentHome = "";
  let currentAway = "";

  // ---------------- Parsing ----------------
  function parseFixtures(fx) {
    const out = [];
    if (!fx) return out;

    const root = fx.fixtures || fx.matches || fx.data || fx;
    if (Array.isArray(root)) {
      for (let i = 0; i < root.length; i++) {
        const f = root[i] || {};
        const league = f.league || f.competition || f.comp || f.League;
        const home = f.home || f.homeTeam || f.Home;
        const away = f.away || f.awayTeam || f.Away;
        const date = f.date || f.kickoff || f.time || "";
        if (!league || !home || !away) continue;

        out.push({
          id: f.id || `${league}__${home}__${away}__${i}`,
          league,
          home,
          away,
          date,
          odds: f.odds || null,
        });
      }
      return out;
    }

    if (root && typeof root === "object") {
      let i = 0;
      for (const k of Object.keys(root)) {
        const f = root[k] || {};
        const league = f.league || f.competition || f.comp || f.League;
        const home = f.home || f.homeTeam || f.Home;
        const away = f.away || f.awayTeam || f.Away;
        const date = f.date || f.kickoff || f.time || "";
        if (!league || !home || !away) continue;

        out.push({
          id: f.id || k || `${league}__${home}__${away}__${i++}`,
          league,
          home,
          away,
          date,
          odds: f.odds || null,
        });
      }
    }

    return out;
  }

  function parseXgLeaguesAndTeams(xg) {
    const rows = [];
    const root = xg?.leagues || xg?.data || xg?.rows || xg;

    if (Array.isArray(root)) {
      for (const r of root) {
        const league = r.league || r.League || r.competition || r.comp;
        const team = r.team || r.Team || r.squad || r.Squad || r.name;
        if (league && team) rows.push({ league: String(league), team: String(team) });
      }
    } else if (root && typeof root === "object") {
      const obj = xg?.leagues && typeof xg.leagues === "object" ? xg.leagues : root;
      for (const lg of Object.keys(obj)) {
        const teamsObj = obj[lg];
        if (!teamsObj) continue;

        if (Array.isArray(teamsObj)) {
          for (const t of teamsObj) {
            const team = t.team || t.name || t.squad;
            if (team) rows.push({ league: String(lg), team: String(team) });
          }
        } else if (typeof teamsObj === "object") {
          for (const tm of Object.keys(teamsObj)) {
            rows.push({ league: String(lg), team: String(tm) });
          }
        }
      }
    }

    leagues = uniqSorted(rows.map((r) => r.league));

    teamsByLeague = new Map();
    for (const lg of leagues) teamsByLeague.set(lg, []);

    for (const r of rows) {
      if (!teamsByLeague.has(r.league)) teamsByLeague.set(r.league, []);
      teamsByLeague.get(r.league).push(r.team);
    }

    for (const lg of teamsByLeague.keys()) {
      teamsByLeague.set(lg, uniqSorted(teamsByLeague.get(lg)));
    }
  }

  // ---------------- UI build ----------------
  function rebuildLeagueSelect() {
    fillSelect(els.league, leagues, "Select league");
  }

  function rebuildFixtureSelect(league) {
    if (!els.fixture) return;
    clearSelect(els.fixture, "Select Fixture (optional)");

    const list = fixtures
      .filter((f) => !league || f.league === league)
      .slice(0, 400);

    for (const f of list) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = `${f.home} vs ${f.away}`;
      els.fixture.appendChild(opt);
    }
  }

  function rebuildTeamSelects(league) {
    const teams = teamsByLeague.get(league) || [];
    fillSelect(els.home, teams, "Select home");
    fillSelect(els.away, teams, "Select away");
  }

  function setReadyLine() {
    if (!els.readyLine) return;
    const ok = !!(currentLeague && currentHome && currentAway);
    els.readyLine.textContent = ok ? "✅ Ready" : "—";
  }

  // ---------------- Events ----------------
  function onLeagueChange() {
    currentLeague = els.league?.value || "";
    currentFixtureId = "";

    if (els.fixture) els.fixture.value = "";

    rebuildFixtureSelect(currentLeague);
    rebuildTeamSelects(currentLeague);

    currentHome = "";
    currentAway = "";
    els.home.value = "";
    els.away.value = "";

    setReadyLine();
  }

  function onFixtureChange() {
    const id = els.fixture?.value || "";
    currentFixtureId = id;
    if (!id) {
      setReadyLine();
      return;
    }

    const f = fixtures.find((x) => x.id === id);
    if (!f) return;

    currentLeague = f.league;
    els.league.value = currentLeague;

    rebuildFixtureSelect(currentLeague);
    els.fixture.value = id;

    rebuildTeamSelects(currentLeague);

    currentHome = f.home;
    currentAway = f.away;

    els.home.value = currentHome;
    els.away.value = currentAway;

    setReadyLine();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onHomeChange() {
    currentHome = els.home?.value || "";
    setReadyLine();
  }

  function onAwayChange() {
    currentAway = els.away?.value || "";
    setReadyLine();
  }

  // ---------------- Load JSON ----------------
  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  async function init() {
    setStatus(els.statusFixtures, false, "fixtures loading…");
    setStatus(els.statusXg, false, "xg loading…");
    setStatus(els.statusH2H, false, "h2h loading…");

    try {
      [fixturesRaw, xgRaw, h2hRaw] = await Promise.all([
        loadJson("./fixtures.json"),
        loadJson("./xg_tables.json"),
        loadJson("./h2h.json"),
      ]);

      fixtures = parseFixtures(fixturesRaw);
      parseXgLeaguesAndTeams(xgRaw);

      setStatus(els.statusFixtures, true, `fixtures OK (${fixtures.length})`);
      setStatus(els.statusXg, true, `xg OK (${leagues.length} leagues)`);
      setStatus(els.statusH2H, true, `h2h OK`);

      rebuildLeagueSelect();
      rebuildFixtureSelect("");
      clearSelect(els.home, "Select home");
      clearSelect(els.away, "Select away");
      setReadyLine();

      // preview table (optional)
      if (els.fixturesTableBody) {
        els.fixturesTableBody.innerHTML = "";
        for (let i = 0; i < Math.min(fixtures.length, 20); i++) {
          const f = fixtures[i];
          const tr = document.createElement("tr");
          tr.style.cursor = "pointer";
          tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${f.home} vs ${f.away}</td>
            <td class="mono">${f.league}</td>
            <td class="mono">${f.date || "—"}</td>
          `;
          tr.addEventListener("click", () => {
            if (!els.fixture) return;
            els.fixture.value = f.id;
            onFixtureChange();
          });
          els.fixturesTableBody.appendChild(tr);
        }
      }
    } catch (e) {
      console.error(e);
      setStatus(els.statusFixtures, false, "fixtures failed");
      setStatus(els.statusXg, false, "xg failed");
      setStatus(els.statusH2H, false, "h2h failed");
      showModal("Prediction error. Data failed to load.\n\nOpen Console for details.");
    }

    // Wire events
    if (els.league) els.league.addEventListener("change", onLeagueChange);
    if (els.fixture) els.fixture.addEventListener("change", onFixtureChange);
    if (els.home) els.home.addEventListener("change", onHomeChange);
    if (els.away) els.away.addEventListener("change", onAwayChange);

    // Run button
    if (els.runBtn) {
      els.runBtn.addEventListener("click", () => {
        try {
          if (!currentLeague || !currentHome || !currentAway) {
            showModal("Select league + home + away first.");
            return;
          }

          if (typeof window.runPrediction !== "function") {
            showModal("Engine not found. Make sure engine.js is loaded correctly.");
            return;
          }

          const params = {
            league: currentLeague,
            home: currentHome,
            away: currentAway,
            sims: Number(els.sims?.value || 10000),
            homeAdv: Number(els.homeAdv?.value || 1.10),
            baseGoals: Number(els.baseGoals?.value || 1.35),
            capGoals: Number(els.capGoals?.value || 8),
            leagueFactorOverride: els.leagueFactor ? Number(els.leagueFactor.value || "") : undefined,
            evThreshold: els.evThresh ? Number(els.evThresh.value || "") : undefined,
            xgRaw,
            fixtures,
            h2hRaw,
          };

          const text = window.runPrediction(params);
          showModal(text);
        } catch (e) {
          console.error(e);
          showModal("Prediction error. Open DevTools Console for details.");
        }
      });
    }

    // also listen if engine dispatches event
    window.addEventListener("matchquant:prediction", (ev) => {
      // if you ever want to auto-display:
      // showModal(ev.detail?.text || "");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
