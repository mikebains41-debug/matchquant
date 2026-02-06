/* MatchQuant app.js — v2
   Fixes:
   - Shows ALL teams (from xg_tables.json), not just fixtures
   - Removes "__league_factor" from team dropdown
   - Robust loading for GitHub Pages paths
   - Sends odds inputs to engine.js for EV badges + AH EV

   Requires files in SAME folder as index.html:
   - fixtures.json
   - xg_tables.json
   - h2h.json  (optional but kept)
*/

(() => {
  "use strict";

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

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

  function absUrl(fileName) {
    return new URL(fileName, window.location.href).toString();
  }

  async function fetchJsonWithRetry(fileName, tries = 3) {
    const url = absUrl(fileName);
    let lastErr;

    for (let i = 0; i < tries; i++) {
      try {
        const bust = `cb=${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const res = await fetch(url + (url.includes("?") ? "&" : "?") + bust, { cache: "no-store" });
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

  // ---------- Data ----------
  let fixtures = [];
  let xgRaw = null;
  let h2hRaw = null;

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
    results: $("results"),
    footerLoaded: $("footerLoaded"),

    // odds inputs
    homeML: $("oddsHome"),
    draw: $("oddsDraw"),
    awayML: $("oddsAway"),
    over25: $("oddsOver25"),
    under25: $("oddsUnder25"),
    bttsYes: $("oddsBTTSYes"),
    bttsNo: $("oddsBTTSNo"),

    ahSide: $("ahSide"),
    ahLine: $("ahLine"),
    ahOdds: $("ahOdds"),
  };

  // ---------- Normalization ----------
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

  function leaguesFromXg() {
    if (!xgRaw) return [];
    const root = xgRaw.leagues || xgRaw;
    if (!root || typeof root !== "object") return [];
    return uniqSorted(Object.keys(root));
  }

  function leaguesFromFixtures() {
    return uniqSorted(fixtures.map((f) => f.league));
  }

  function allLeagues() {
    // union: fixtures + xg leagues
    return uniqSorted([ ...leaguesFromFixtures(), ...leaguesFromXg() ]);
  }

  function fixturesForLeague(leagueName) {
    if (!leagueName) return fixtures.slice();
    return fixtures.filter((f) => f.league === leagueName);
  }

  function teamsFromXg(leagueName) {
    if (!xgRaw) return [];
    const root = xgRaw.leagues || xgRaw.data || xgRaw;

    // if array format
    if (Array.isArray(root)) {
      return uniqSorted(
        root
          .filter(r =>
            (r.league === leagueName || r.competition === leagueName) &&
            r.team &&
            !String(r.team).startsWith("__")
          )
          .map(r => r.team)
      );
    }

    // object format: root[leagueName] = { "__league_factor":1.0, "Arsenal": {...} }
    if (root && root[leagueName]) {
      return uniqSorted(
        Object.keys(root[leagueName]).filter((k) => !String(k).startsWith("__"))
      );
    }

    return [];
  }

  function teamsFromFixtures(leagueName) {
    const lf = fixturesForLeague(leagueName);
    return uniqSorted(lf.flatMap((f) => [f.home, f.away]));
  }

  // ---------- UI rebuild ----------
  function rebuildLeagueSelect() {
    setSelectOptions(els.league, allLeagues(), "Select league");
  }

  function rebuildFixtureSelect(leagueName) {
    if (!els.fixture) return;

    const list = fixturesForLeague(leagueName);
    els.fixture.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select Fixture (optional)";
    els.fixture.appendChild(ph);

    for (const f of list) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = `${f.home} vs ${f.away}` + (f.date ? ` (${f.date})` : "");
      els.fixture.appendChild(opt);
    }
  }

  function rebuildTeamSelects(leagueName) {
    // Priority: xG teams (full league list), fallback: fixture teams
    let teams = teamsFromXg(leagueName);
    if (!teams.length) teams = teamsFromFixtures(leagueName);

    setSelectOptions(els.home, teams, "Select home");
    setSelectOptions(els.away, teams, "Select away");
  }

  function onLeagueChange() {
    const lg = els.league?.value || "";
    rebuildFixtureSelect(lg);
    rebuildTeamSelects(lg);
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

    if (els.home) els.home.value = f.home;
    if (els.away) els.away.value = f.away;
  }

  function readOdds() {
    const num = (el) => {
      if (!el) return null;
      const n = Number(el.value);
      return isFinite(n) ? n : null;
    };

    return {
      homeML: num(els.homeML),
      draw: num(els.draw),
      awayML: num(els.awayML),
      over25: num(els.over25),
      under25: num(els.under25),
      bttsYes: num(els.bttsYes),
      bttsNo: num(els.bttsNo),

      ahSide: els.ahSide?.value || "home",
      ahLine: els.ahLine ? Number(els.ahLine.value) : null,
      ahOdds: num(els.ahOdds),
    };
  }

  function renderResults(r) {
    if (!els.results) {
      // fallback
      alert(JSON.stringify(r, null, 2));
      return;
    }

    const evLine = (name, evObj) => {
      const b = evObj.badge;
      return `${b.badge} ${name}: ${b.label}`;
    };

    const top5 = r.score.top5.map((x) => `${x.s} (${(x.pr * 100).toFixed(1)}%)`).join("\n");

    const ahText = r.ah
      ? [
          `AH (${r.ah.side} ${r.ah.line > 0 ? "+" : ""}${r.ah.line} @ ${r.ah.odds || "—"}):`,
          `Cover-ish: ${(r.ah.cover * 100).toFixed(1)}% | Fail-ish: ${(r.ah.fail * 100).toFixed(1)}%`,
          `${r.ah.badge.badge} ${r.ah.badge.label}`,
        ].join("\n")
      : `AH lean (no line selected): ${r.lean.side} ${r.lean.market} (signal ${(r.lean.strength * 100).toFixed(1)}%)`;

    const miss = r.meta.missingTeams?.length
      ? `\n⚠️ Missing xG mapping for: ${r.meta.missingTeams.join(", ")}\n(Still works, but downgrades confidence.)`
      : "";

    els.results.textContent =
      `Match: ${r.meta.home} vs ${r.meta.away}\n` +
      `League: ${r.meta.league}\n\n` +

      `Win Probabilities (Poisson, deterministic):\n` +
      `${r.meta.home}: ${pct(r.probs.homeWin)}\n` +
      `Draw: ${pct(r.probs.draw)}\n` +
      `${r.meta.away}: ${pct(r.probs.awayWin)}\n\n` +

      `Most Likely Score: ${r.score.mostLikely}\n\n` +

      `O/U 2.5:\n` +
      `Over 2.5: ${pct(r.probs.over25)}\n` +
      `Under 2.5: ${pct(r.probs.under25)}\n\n` +

      `BTTS:\n` +
      `Yes: ${pct(r.probs.bttsYes)}\n` +
      `No: ${pct(r.probs.bttsNo)}\n\n` +

      `Confidence Grade: ${r.confidence.grade}\n` +
      `Note: ${r.confidence.note}\n\n` +

      `EV (if odds entered):\n` +
      `${evLine("Home ML", r.ev.homeML)}\n` +
      `${evLine("Draw", r.ev.draw)}\n` +
      `${evLine("Away ML", r.ev.awayML)}\n` +
      `${evLine("Over 2.5", r.ev.over25)}\n` +
      `${evLine("Under 2.5", r.ev.under25)}\n` +
      `${evLine("BTTS Yes", r.ev.bttsYes)}\n` +
      `${evLine("BTTS No", r.ev.bttsNo)}\n\n` +

      `${ahText}\n\n` +

      `Model inputs:\n` +
      `league_factor: ${Number(r.meta.leagueFactor).toFixed(2)}\n` +
      `mu(home): ${r.means.muHome.toFixed(2)}\n` +
      `mu(away): ${r.means.muAway.toFixed(2)}\n\n` +

      `Top 5 scorelines:\n${top5}` +
      miss;
  }

  function runPrediction() {
    try {
      const league = els.league?.value || "";
      const home = els.home?.value || "";
      const away = els.away?.value || "";

      if (!league || !home || !away) {
        alert("MatchQuant says\n\nSelect league + home + away.");
        return;
      }

      if (typeof window.runPrediction !== "function") {
        alert("MatchQuant says\n\nEngine not found. Make sure engine.js loads before app.js.");
        return;
      }

      const payload = {
        league,
        home,
        away,
        sims: Number(els.sims?.value || 10000), // kept for UI compatibility
        homeAdv: Number(els.homeAdv?.value || 1.10),
        baseGoals: Number(els.baseGoals?.value || 1.35),
        capGoals: Number(els.capGoals?.value || 8),
        xgRaw,
        fixtures,
        h2hRaw,
        odds: readOdds(),
      };

      const r = window.runPrediction(payload);
      renderResults(r);
    } catch (e) {
      console.error("[MatchQuant] Prediction crash:", e);
      alert("MatchQuant says\n\nPrediction error. Open Console for details.");
    }
  }

  // ---------- Init ----------
  async function init() {
    try {
      const [fixturesRaw, xg, h2h] = await Promise.all([
        fetchJsonWithRetry("fixtures.json", 3),
        fetchJsonWithRetry("xg_tables.json", 3),
        fetchJsonWithRetry("h2h.json", 3),
      ]);

      fixtures = normalizeFixtures(fixturesRaw);
      xgRaw = xg;
      h2hRaw = h2h;

      rebuildLeagueSelect();
      rebuildFixtureSelect("");
      rebuildTeamSelects("");

      els.league?.addEventListener("change", onLeagueChange);
      els.fixture?.addEventListener("change", onFixtureChange);
      els.runBtn?.addEventListener("click", runPrediction);

      if (els.footerLoaded) {
        const lgs = allLeagues();
        els.footerLoaded.textContent = `Loaded: ${lgs.length} leagues • ${fixtures.length} fixtures`;
      }
    } catch (e) {
      console.error("[MatchQuant] DATA LOAD FAILED:", e);
      alert(
        "MatchQuant says\n\nData failed to load.\n\n" +
          "Checklist:\n" +
          "1) fixtures.json, xg_tables.json, h2h.json are in SAME folder as index.html\n" +
          "2) Filenames match EXACTLY\n" +
          "3) Hard refresh after push\n"
      );
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
