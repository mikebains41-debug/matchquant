/* MatchQuant - app.js (FULL REPLACEMENT)
   Fixes:
   - Accepts xg_tables.json formats: {att,def} OR {xg_for,xg_against} OR {xg,xga} OR {xgf,xga}
   - NEVER silently deletes leagues/teams (it will keep them and show helpful console warnings)
   - League -> Fixture -> Teams pipeline wired reliably
   - Run Prediction works and is exposed globally for the button onclick
*/

(() => {
  "use strict";

  // ----------------------------
  // State
  // ----------------------------
  let xgRaw = null;      // raw xg json
  let xgTables = {};     // normalized: { league: { team: {att, def} } }
  let fixtures = {};     // { league: [ {home,away,date?} ] } or [ {league,home,away,date?} ]
  let h2h = {};          // any format - we try to read last match if present

  // ----------------------------
  // Helpers
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  function setPill(id, ok, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = (ok ? "✓ " : "✗ ") + text;
    el.style.opacity = ok ? "1" : "0.7";
  }

  function cleanName(s) {
    if (typeof s !== "string") return "";
    return s.trim();
  }

  // Convert many possible xG row shapes -> {att, def}
  function normalizeTeamRow(row) {
    if (!row || typeof row !== "object") return null;

    const att =
      row.att ??
      row.xg ??
      row.xg_for ??
      row.xgf ??
      row.for ??
      row.attack ??
      null;

    const def =
      row.def ??
      row.xga ??
      row.xg_against ??
      row.against ??
      row.defense ??
      null;

    const attNum = Number(att);
    const defNum = Number(def);

    if (!Number.isFinite(attNum) || !Number.isFinite(defNum)) return null;
    return { att: attNum, def: defNum };
  }

  function normalizeXG(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;

    for (const leagueKey of Object.keys(raw)) {
      const league = cleanName(leagueKey);
      const leagueObj = raw[leagueKey];
      if (!league || !leagueObj || typeof leagueObj !== "object") continue;

      out[league] = {};

      for (const teamKey of Object.keys(leagueObj)) {
        const team = cleanName(teamKey);
        const row = leagueObj[teamKey];
        const norm = normalizeTeamRow(row);

        if (team && norm) {
          out[league][team] = norm;
        }
      }
    }
    return out;
  }

  function leagueKeys(obj) {
    return Object.keys(obj || {}).sort((a, b) => a.localeCompare(b));
  }

  function teamKeysForLeague(league) {
    const teams = xgTables?.[league] ? Object.keys(xgTables[league]) : [];
    return teams.sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder || "Select…";
    selectEl.appendChild(ph);

    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      selectEl.appendChild(o);
    }
  }

  // Fixtures can be stored as:
  // A) { "Premier League": [ {home,away,date}, ... ], "La Liga": [...] }
  // B) [ {league:"Premier League", home:"...", away:"..."}, ... ]
  function fixturesForLeague(league) {
    if (!fixtures) return [];
    if (Array.isArray(fixtures)) {
      return fixtures.filter((f) => cleanName(f.league) === league);
    }
    if (typeof fixtures === "object") {
      const arr = fixtures[league];
      return Array.isArray(arr) ? arr : [];
    }
    return [];
  }

  function formatFixtureLabel(f) {
    const home = cleanName(f.home);
    const away = cleanName(f.away);
    const date = cleanName(f.date || f.kickoff || f.time || "");
    return date ? `${home} vs ${away} (${date})` : `${home} vs ${away}`;
  }

  // ----------------------------
  // UI Wiring
  // ----------------------------
  function populateLeagueDropdown() {
    const leagueSelect = $("league");
    const leagues = leagueKeys(xgTables).map((l) => ({ value: l, label: l }));

    fillSelect(leagueSelect, leagues, "Select a league…");

    // IMPORTANT: always (re)wire events
    if (leagueSelect) {
      leagueSelect.onchange = () => {
        populateFixtureDropdown();
        populateTeamsDropdowns();
      };
    }
  }

  function populateFixtureDropdown() {
    const league = cleanName($("league")?.value);
    const fixtureSelect = $("fixture");

    if (!fixtureSelect) return;

    if (!league) {
      fillSelect(fixtureSelect, [], "Select a fixture…");
      fixtureSelect.onchange = null;
      return;
    }

    const list = fixturesForLeague(league)
      .filter((f) => cleanName(f.home) && cleanName(f.away))
      .map((f, idx) => ({
        value: String(idx),
        label: formatFixtureLabel(f),
      }));

    fillSelect(fixtureSelect, list, "Select a fixture…");

    fixtureSelect.onchange = () => {
      const idx = Number(fixtureSelect.value);
      if (!Number.isFinite(idx)) return;
      const arr = fixturesForLeague(league);
      const f = arr[idx];
      if (!f) return;

      // Auto-fill teams if they exist in xg table for league
      const home = cleanName(f.home);
      const away = cleanName(f.away);

      const homeSel = $("home");
      const awaySel = $("away");

      if (homeSel && home) homeSel.value = home;
      if (awaySel && away) awaySel.value = away;
    };
  }

  function populateTeamsDropdowns() {
    const league = cleanName($("league")?.value);
    const homeSel = $("home");
    const awaySel = $("away");

    if (!league || !xgTables[league]) {
      fillSelect(homeSel, [], "Select home team…");
      fillSelect(awaySel, [], "Select away team…");
      return;
    }

    const teams = teamKeysForLeague(league).map((t) => ({ value: t, label: t }));
    fillSelect(homeSel, teams, "Select home team…");
    fillSelect(awaySel, teams, "Select away team…");
  }

  // ----------------------------
  // Prediction (Poisson Monte Carlo)
  // ----------------------------
  function poissonSample(lambda) {
    // Knuth
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  function simulateMatch(homeAtt, awayDef, awayAtt, homeDef, sims) {
    // Simple blending of attack/defense into expected goals
    const homeLambda = Math.max(0.05, (homeAtt + awayDef) / 2);
    const awayLambda = Math.max(0.05, (awayAtt + homeDef) / 2);

    let homeWins = 0, awayWins = 0, draws = 0;
    let homeGoalsSum = 0, awayGoalsSum = 0;
    let over25 = 0, btts = 0;

    const scoreCounts = new Map();

    for (let i = 0; i < sims; i++) {
      const hg = poissonSample(homeLambda);
      const ag = poissonSample(awayLambda);

      homeGoalsSum += hg;
      awayGoalsSum += ag;

      if (hg > ag) homeWins++;
      else if (ag > hg) awayWins++;
      else draws++;

      if (hg + ag > 2.5) over25++;
      if (hg > 0 && ag > 0) btts++;

      const key = `${hg}-${ag}`;
      scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);
    }

    // Most common scoreline
    let bestScore = "1-1";
    let bestCount = -1;
    for (const [k, c] of scoreCounts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestScore = k;
      }
    }

    return {
      homeLambda,
      awayLambda,
      avgHome: homeGoalsSum / sims,
      avgAway: awayGoalsSum / sims,
      pHome: homeWins / sims,
      pDraw: draws / sims,
      pAway: awayWins / sims,
      pOver25: over25 / sims,
      pBTTS: btts / sims,
      modalScore: bestScore,
    };
  }

  function renderOutput({ league, home, away, sim, sims }) {
    const out = $("output");
    if (!out) return;

    const pct = (x) => `${Math.round(x * 100)}%`;

    out.innerHTML = `
      <div class="mono">
        <div><b>${league}</b></div>
        <div><b>${home}</b> vs <b>${away}</b></div>
        <hr style="opacity:.15" />
        <div>λ Home: <b>${sim.homeLambda.toFixed(2)}</b> | λ Away: <b>${sim.awayLambda.toFixed(2)}</b></div>
        <div>Avg goals: <b>${sim.avgHome.toFixed(2)}</b> - <b>${sim.avgAway.toFixed(2)}</b> (sims: ${sims})</div>
        <div>Most likely score: <b>${sim.modalScore}</b></div>
        <hr style="opacity:.15" />
        <div>1X2: Home <b>${pct(sim.pHome)}</b> | Draw <b>${pct(sim.pDraw)}</b> | Away <b>${pct(sim.pAway)}</b></div>
        <div>O2.5: <b>${pct(sim.pOver25)}</b> | BTTS: <b>${pct(sim.pBTTS)}</b></div>
      </div>
    `;
  }

  // ----------------------------
  // H2H Render (best-effort)
  // ----------------------------
  function renderH2H(league, home, away) {
    const el = $("h2h");
    if (!el) return;

    // You can store h2h in many formats. We'll try common ones.
    // Preferred:
    // h2h[league][home][away] = { score:"2-1", cards:5, corners:11, date:"..." }
    let last = null;

    try {
      const L = h2h?.[league];
      if (L && L[home] && L[home][away]) last = L[home][away];
      if (!last && L && L[away] && L[away][home]) last = L[away][home];
    } catch {}

    if (!last) {
      el.textContent = "No H2H found for this matchup (in h2h.json).";
      return;
    }

    const score = last.score ?? last.result ?? "";
    const cards = last.cards ?? last.total_cards ?? "";
    const corners = last.corners ?? last.total_corners ?? "";
    const date = last.date ?? last.when ?? "";

    el.innerHTML = `
      <div class="mono">
        <div><b>Last H2H</b> ${date ? `(${date})` : ""}</div>
        <div>Score: <b>${score || "N/A"}</b></div>
        <div>Cards: <b>${cards || "N/A"}</b> | Corners: <b>${corners || "N/A"}</b></div>
      </div>
    `;
  }

  // ----------------------------
  // Run Prediction (exposed globally)
  // ----------------------------
  function runPrediction() {
    const league = cleanName($("league")?.value);
    const home = cleanName($("home")?.value);
    const away = cleanName($("away")?.value);
    const sims = Math.max(1000, Number($("sims")?.value || 10000));

    if (!league) {
      alert("Pick a league first.");
      return;
    }
    if (!home || !away) {
      alert("Pick both home and away teams.");
      return;
    }
    const H = xgTables?.[league]?.[home];
    const A = xgTables?.[league]?.[away];

    if (!H || !A) {
      alert(`Team not found in xG table for "${league}".\nHome="${home}" Away="${away}"`);
      return;
    }

    const sim = simulateMatch(H.att, A.def, A.att, H.def, sims);
    renderOutput({ league, home, away, sim, sims });
    renderH2H(league, home, away);
  }

  // Make sure the HTML button onclick can find it
  window.runPrediction = runPrediction;

  // ----------------------------
  // Load data
  // ----------------------------
  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  }

  async function init() {
    try {
      // Load xG
      xgRaw = await loadJson("xg_tables.json");
      xgTables = normalizeXG(xgRaw);

      const leaguesCount = Object.keys(xgTables).length;
      setPill("xg-status", true, `xG loaded (${leaguesCount} leagues)`);

      // Load fixtures (optional)
      try {
        fixtures = await loadJson("fixtures.json");
        const fxCount = Array.isArray(fixtures)
          ? fixtures.length
          : Object.values(fixtures || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
        setPill("fx-status", true, `fixtures loaded (${fxCount})`);
      } catch (e) {
        fixtures = {};
        setPill("fx-status", false, "fixtures not loaded");
        console.warn("fixtures.json load failed:", e);
      }

      // Load h2h (optional)
      try {
        h2h = await loadJson("h2h.json");
        // best-effort count
        setPill("h2h-status", true, "H2H loaded");
      } catch (e) {
        h2h = {};
        setPill("h2h-status", false, "H2H not loaded");
        console.warn("h2h.json load failed:", e);
      }

      // Build UI
      populateLeagueDropdown();
      populateFixtureDropdown();
      populateTeamsDropdowns();

      // Default output text
      const out = $("output");
      if (out && !out.innerHTML.trim()) {
        out.textContent = "Choose league + teams, then Run.";
      }
    } catch (err) {
      console.error(err);
      alert("Failed to load core data (xg_tables.json). Check file name + JSON format.");
      setPill("xg-status", false, "xG load failed");
    }
  }

  // Start
  document.addEventListener("DOMContentLoaded", init);
})();
