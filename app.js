/* MatchQuant app.js — FULL REPLACEMENT
   Fixes:
   - "Data failed to load" on GitHub Pages
   - Removes "__league_factor" from team dropdowns
   - Better fixture -> team matching (case/spacing)
   Assumes these files exist in SAME folder as index.html:
   - fixtures.json
   - xg_tables.json
   - h2h.json
*/

(() => {
  "use strict";

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ");

  function byText(a, b) {
    return String(a).localeCompare(String(b));
  }

  function uniqSorted(arr) {
    return Array.from(new Set(arr)).filter(Boolean).sort(byText);
  }

  function setSelectOptions(selectEl, items, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder || "Select";
    selectEl.appendChild(ph);

    for (const t of items) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      selectEl.appendChild(opt);
    }
  }

  function setStatus(el, ok, msg) {
    if (!el) return;
    el.textContent = msg || "";
    el.style.opacity = ok ? "1" : "0.9";
    el.style.color = ok ? "#22c55e" : "#ef4444";
  }

  function absUrl(fileName) {
    return new URL(fileName, window.location.href).toString();
  }

  async function fetchJsonWithRetry(fileName, tries = 3) {
    const url = absUrl(fileName);
    let lastErr;

    for (let i = 0; i < tries; i++) {
      try {
        const bust = `cb=${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const res = await fetch(url + (url.includes("?") ? "&" : "?") + bust, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${fileName} HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(`[MatchQuant] Fetch failed (${fileName}) try ${i + 1}/${tries}:`, e);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw lastErr;
  }

  // ---------- Data model ----------
  let fixtures = []; // [{id, league, home, away, date?}]
  let xgRaw = null;
  let h2hRaw = null;

  let leagues = [];

  // ---------- Elements ----------
  const els = {
    league: $("league"),
    fixture: $("fixture"),
    home: $("home"),
    away: $("away"),
    sims: $("sims"),
    homeAdv: $("homeAdv"),
    baseGoals: $("baseGoals"),
    capGoals: $("capGoals"),
    runBtn: $("runBtn"),

    statusFixtures: $("statusFixtures"),
    statusXg: $("statusXg"),
    statusH2H: $("statusH2H"),
    statusReady: $("statusReady"),
    footerLoaded: $("footerLoaded"),
  };

  // ---------- Parsing ----------
  function normalizeFixtures(raw) {
    const out = [];

    const arr =
      Array.isArray(raw) ? raw :
      Array.isArray(raw?.fixtures) ? raw.fixtures :
      Array.isArray(raw?.data) ? raw.data :
      [];

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i] || {};
      const league = f.league || f.competition || f.lg || "";
      const home = f.home || f.homeTeam || f.h || "";
      const away = f.away || f.awayTeam || f.a || "";
      if (!league || !home || !away) continue;

      out.push({
        id: f.id ?? `${league}__${home}__${away}__${i}`,
        league,
        home,
        away,
        date: f.date || f.kickoff || f.time || "",
      });
    }
    return out;
  }

  function leaguesFromFixtures(fixturesArr) {
    return uniqSorted(fixturesArr.map((f) => f.league));
  }

  function fixturesForLeague(leagueName) {
    if (!leagueName) return fixtures.slice();
    return fixtures.filter((f) => f.league === leagueName);
  }

  function teamsFromXg(leagueName) {
    if (!xgRaw) return [];

    const root = xgRaw.leagues || xgRaw.data || xgRaw;

    // array shape (rare)
    if (Array.isArray(root)) {
      return uniqSorted(
        root
          .filter((r) =>
            (r.league === leagueName || r.competition === leagueName) &&
            r.team &&
            !String(r.team).startsWith("__")
          )
          .map((r) => r.team)
      );
    }

    // object shape: xgRaw[leagueName] = { team: {att,def}, "__league_factor": 1.0 }
    if (root && root[leagueName] && typeof root[leagueName] === "object") {
      return uniqSorted(
        Object.keys(root[leagueName]).filter((k) => !String(k).startsWith("__"))
      );
    }

    return [];
  }

  // ---------- UI rebuild ----------
  function rebuildLeagueSelect() {
    setSelectOptions(els.league, leagues, "Select league");
  }

  function rebuildFixtureSelect(leagueName) {
    const list = fixturesForLeague(leagueName);
    const labels = list.map((f) => ({
      id: f.id,
      label: `${f.home} vs ${f.away}` + (f.date ? ` (${f.date})` : ""),
    }));

    if (!els.fixture) return;
    els.fixture.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select Fixture (optional)";
    els.fixture.appendChild(ph);

    for (const item of labels) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      els.fixture.appendChild(opt);
    }
  }

  function rebuildTeamSelects(leagueName) {
    // Priority: xG teams (complete league), fallback: teams from fixtures
    let teams = teamsFromXg(leagueName);

    if (!teams.length) {
      const lf = fixturesForLeague(leagueName);
      teams = uniqSorted(lf.flatMap((f) => [f.home, f.away]));
    }

    // build normalization map so fixture team names snap to exact xG keys
    const teamNormMap = {};
    for (const t of teams) teamNormMap[norm(t)] = t;

    setSelectOptions(els.home, teams, "Select home");
    setSelectOptions(els.away, teams, "Select away");

    // attach map for use in onFixtureChange
    rebuildTeamSelects.teamNormMap = teamNormMap;
  }

  function setReady(ok, msg) {
    setStatus(els.statusReady, ok, msg);
  }

  function syncReadyState() {
    const ok = !!(fixtures.length && xgRaw && h2hRaw);
    setReady(ok, ok ? "Ready" : "Loading…");
  }

  function onLeagueChange() {
    const lg = els.league?.value || "";
    rebuildFixtureSelect(lg);
    rebuildTeamSelects(lg);
    setReady(true, "Ready");
  }

  function onFixtureChange() {
    const id = els.fixture?.value || "";
    if (!id) return;

    const f = fixtures.find((x) => String(x.id) === String(id));
    if (!f) return;

    if (els.league && els.league.value !== f.league) {
      els.league.value = f.league;
      rebuildFixtureSelect(f.league);
      rebuildTeamSelects(f.league);
      els.fixture.value = f.id;
    }

    const map = rebuildTeamSelects.teamNormMap || {};
    const h = map[norm(f.home)] || f.home;
    const a = map[norm(f.away)] || f.away;

    if (els.home) els.home.value = h;
    if (els.away) els.away.value = a;

    setReady(true, "Ready");
  }

  function runPrediction() {
    try {
      if (!fixtures.length || !xgRaw) {
        alert("MatchQuant says\n\nPrediction error. Data failed to load.\n\nOpen Console for details.");
        console.error("[MatchQuant] Missing data:", { fixtures: fixtures.length, xgRaw: !!xgRaw, h2hRaw: !!h2hRaw });
        return;
      }

      const league = els.league?.value || "";
      const home = els.home?.value || "";
      const away = els.away?.value || "";

      if (!league || !home || !away) {
        alert("MatchQuant says\n\nSelect league + home + away.");
        return;
      }

      const params = {
        league,
        home,
        away,
        sims: Number(els.sims?.value || 10000),
        homeAdv: Number(els.homeAdv?.value || 1.10),
        baseGoals: Number(els.baseGoals?.value || 1.35),
        capGoals: Number(els.capGoals?.value || 8),
        xgRaw,
        fixtures,
        h2hRaw,
      };

      if (typeof window.runPrediction === "function") {
        window.runPrediction(params);
      } else {
        alert("MatchQuant says\n\nEngine not found. Make sure engine.js loads before app.js.");
        console.warn("[MatchQuant] window.runPrediction is not defined.");
      }
    } catch (e) {
      console.error("[MatchQuant] Prediction crash:", e);
      alert("MatchQuant says\n\nPrediction error. Open Console for details.");
    }
  }

  async function init() {
    setStatus(els.statusFixtures, false, "fixtures loading…");
    setStatus(els.statusXg, false, "xg loading…");
    setStatus(els.statusH2H, false, "h2h loading…");
    setReady(false, "Loading…");

    try {
      const [fixturesRaw, xg, h2h] = await Promise.all([
        fetchJsonWithRetry("fixtures.json", 3),
        fetchJsonWithRetry("xg_tables.json", 3),
        fetchJsonWithRetry("h2h.json", 3),
      ]);

      fixtures = normalizeFixtures(fixturesRaw);
      xgRaw = xg;
      h2hRaw = h2h;

      leagues = leaguesFromFixtures(fixtures);

      setStatus(els.statusFixtures, true, `fixtures OK (${fixtures.length})`);
      setStatus(els.statusXg, true, `xg OK`);
      setStatus(els.statusH2H, true, `h2h OK`);

      rebuildLeagueSelect();
      rebuildFixtureSelect("");
      rebuildTeamSelects("");

      els.league?.addEventListener("change", onLeagueChange);
      els.fixture?.addEventListener("change", onFixtureChange);
      els.runBtn?.addEventListener("click", runPrediction);

      if (els.footerLoaded) {
        els.footerLoaded.textContent = `Loaded: ${leagues.length} leagues • ${fixtures.length} fixtures`;
      }

      syncReadyState();
    } catch (e) {
      console.error("[MatchQuant] DATA LOAD FAILED:", e);
      setStatus(els.statusFixtures, false, "fixtures FAIL");
      setStatus(els.statusXg, false, "xg FAIL");
      setStatus(els.statusH2H, false, "h2h FAIL");
      setReady(false, "Not Ready");

      alert(
        "MatchQuant says\n\nPrediction error. Data failed to load.\n\n" +
        "Fix checklist:\n" +
        "1) Make sure fixtures.json, xg_tables.json, h2h.json are in the SAME folder as index.html\n" +
        "2) Filenames must match EXACTLY (lowercase)\n" +
        "3) After pushing to GitHub, hard refresh\n\n" +
        "Open Console for details."
      );
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
