/* MatchQuant - app.js (FULL REPLACEMENT)
   - Loads xg_tables.json, fixtures.json, h2h.json
   - Populates League/Fixture/Home/Away dropdowns
   - Monte Carlo Poisson sims + probabilities + fair odds
   - Fixes H2H undefined score
*/

(() => {
  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  const safeText = (el, txt) => { if (el) el.textContent = txt; };
  const safeHTML = (el, html) => { if (el) el.innerHTML = html; };

  const norm = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "'")
      .replace(/\./g, "")
      .replace(/fc\b/g, "")
      .replace(/\bsc\b/g, "")
      .replace(/\bcd\b/g, "")
      .replace(/\bcf\b/g, "")
      .replace(/\bcalcio\b/g, "")
      .replace(/\bsaint\b/g, "st")
      .replace(/\s+/g, " ")
      .trim();

  const cap = (s) =>
    String(s ?? "")
      .split(" ")
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const cacheBust = () => `?v=${Date.now()}`;

  async function loadJSON(path) {
    const res = await fetch(path + cacheBust(), { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  }

  function setOptions(selectEl, options, placeholder = "Select...") {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    selectEl.appendChild(ph);

    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      selectEl.appendChild(o);
    }
  }

  function toFixed2(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x.toFixed(2) : "—";
  }

  // ---------- poisson + sims ----------
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

  function clampLambda(x) {
    // prevent crazy results
    const v = Number(x);
    if (!Number.isFinite(v)) return 1.25;
    return Math.min(3.5, Math.max(0.2, v));
  }

  function deriveLambdas(leagueXG, home, away) {
    // expects objects {att, def}
    const h = leagueXG?.[home];
    const a = leagueXG?.[away];

    // fallback if missing
    const hatt = h?.att ?? 1.25;
    const hdef = h?.def ?? 1.00;
    const aatt = a?.att ?? 1.25;
    const adef = a?.def ?? 1.00;

    // basic model (multiplicative)
    const homeLambda = clampLambda(hatt * adef);
    const awayLambda = clampLambda(aatt * hdef);

    return { homeLambda, awayLambda };
  }

  function fairOdds(p) {
    // decimal odds
    if (!Number.isFinite(p) || p <= 0) return Infinity;
    return 1 / p;
  }

  // ---------- H2H ----------
  function findH2H(h2hArr, league, home, away) {
    if (!Array.isArray(h2hArr)) return null;
    const L = norm(league);
    const h = norm(home);
    const a = norm(away);

    // allow either direction
    return h2hArr.find(r => {
      const rl = norm(r.league ?? r.competition ?? "");
      const rh = norm(r.home ?? r.home_team ?? r.team_home ?? "");
      const ra = norm(r.away ?? r.away_team ?? r.team_away ?? "");
      const okLeague = !rl || rl === L; // if file doesn't store league, still match by teams
      const dir1 = (rh === h && ra === a);
      const dir2 = (rh === a && ra === h);
      return okLeague && (dir1 || dir2);
    }) ?? null;
  }

  function h2hLine(r, home, away) {
    if (!r) return `No H2H found for this matchup (in h2h.json).`;

    // try multiple key names safely
    const hs = r.home_score ?? r.score_home ?? r.goals_home ?? r.h ?? r.hg;
    const as = r.away_score ?? r.score_away ?? r.goals_away ?? r.a ?? r.ag;

    const cards = r.cards ?? r.total_cards ?? r.card_total;
    const corners = r.corners ?? r.total_corners ?? r.corner_total;

    const hasScore = Number.isFinite(Number(hs)) && Number.isFinite(Number(as));
    const scoreTxt = hasScore ? `${Number(hs)}-${Number(as)}` : null;

    const parts = [];
    if (scoreTxt) parts.push(`${home} ${scoreTxt} ${away}`);
    else parts.push(`${home} vs ${away}`);

    if (Number.isFinite(Number(cards))) parts.push(`Cards: ${Number(cards)}`);
    if (Number.isFinite(Number(corners))) parts.push(`Corners: ${Number(corners)}`);

    return parts.join(" | ");
  }

  // ---------- fixtures ----------
  function buildFixtureOptions(fixturesArr, league) {
    if (!Array.isArray(fixturesArr)) return [];
    const L = norm(league);
    const filtered = fixturesArr.filter(f => !league || norm(f.league ?? f.competition ?? "") === L);
    // if no league stored in fixtures.json, just show all
    const base = filtered.length ? filtered : fixturesArr;

    return base
      .map((f, idx) => {
        const home = f.home ?? f.home_team ?? f.team_home ?? "";
        const away = f.away ?? f.away_team ?? f.team_away ?? "";
        const date = f.date ?? f.kickoff ?? f.time ?? "";
        const label = `${home} vs ${away}${date ? ` (${date})` : ""}`;
        return { value: String(idx), label, fixture: f };
      });
  }

  function tryAutofillFromFixture(f) {
    const home = f?.home ?? f?.home_team ?? f?.team_home ?? "";
    const away = f?.away ?? f?.away_team ?? f?.team_away ?? "";
    return { home, away };
  }

  // ---------- app state ----------
  let XG = null;         // object: { League: { Team: {att, def}, ... }, ... }
  let FIX = null;        // array of fixtures
  let H2H = null;        // array of h2h rows

  let fixtureCache = []; // options objects w/ fixture attached

  // ---------- DOM ----------
  const elLeague = $("league");
  const elFixture = $("fixture");
  const elHome = $("homeTeam");
  const elAway = $("awayTeam");
  const elSims = $("sims");
  const elOut = $("output");
  const elH2H = $("h2h");
  const elFixturesList = $("fixturesList") || $("todayFixtures") || $("fixtures"); // support old ids

  function getSelectedLeague() {
    return elLeague?.value || "";
  }

  function getSims() {
    const n = Number(elSims?.value ?? 10000);
    if (!Number.isFinite(n)) return 10000;
    return Math.min(200000, Math.max(1000, Math.floor(n)));
  }

  function leagueTeams(league) {
    const tbl = XG?.[league];
    if (!tbl) return [];
    return Object.keys(tbl).sort((a, b) => a.localeCompare(b));
  }

  function refreshLeagueDropdown() {
    const leagues = XG ? Object.keys(XG).sort((a, b) => a.localeCompare(b)) : [];
    setOptions(elLeague, leagues.map(l => ({ value: l, label: l })), "Select a league...");
  }

  function refreshTeamsDropdowns(league) {
    const teams = leagueTeams(league);
    setOptions(elHome, teams.map(t => ({ value: t, label: t })), "Select home team...");
    setOptions(elAway, teams.map(t => ({ value: t, label: t })), "Select away team...");
  }

  function refreshFixtureDropdown(league) {
    fixtureCache = buildFixtureOptions(FIX, league);
    setOptions(elFixture, fixtureCache.map((o, i) => ({ value: String(i), label: o.label })), "Select a fixture...");
  }

  function showLoadedBadges() {
    // if you have elements like xgStatus/fixturesStatus/h2hStatus, update them
    const xgBadge = $("xgStatus");
    const fixBadge = $("fixturesStatus");
    const h2hBadge = $("h2hStatus");

    if (xgBadge) safeText(xgBadge, XG ? `xG loaded (${Object.keys(XG).length} leagues)` : "xG NOT loaded");
    if (fixBadge) safeText(fixBadge, FIX ? `fixtures loaded (${FIX.length})` : "fixtures NOT loaded");
    if (h2hBadge) safeText(h2hBadge, H2H ? `H2H loaded (${H2H.length})` : "H2H NOT loaded");
  }

  function showTodayFixtures(league) {
    if (!elFixturesList) return;

    if (!Array.isArray(FIX) || !FIX.length) {
      safeText(elFixturesList, "—");
      return;
    }

    const L = norm(league);
    const rows = FIX.filter(f => {
      const fl = norm(f.league ?? f.competition ?? "");
      return league ? (fl ? fl === L : true) : true;
    }).slice(0, 50);

    if (!rows.length) {
      safeText(elFixturesList, "—");
      return;
    }

    const lines = rows.map(f => {
      const h = f.home ?? f.home_team ?? f.team_home ?? "";
      const a = f.away ?? f.away_team ?? f.team_away ?? "";
      const d = f.date ?? f.kickoff ?? "";
      return `${h} vs ${a}${d ? ` (${d})` : ""}`;
    });

    safeText(elFixturesList, lines.join("\n"));
  }

  // ---------- main prediction ----------
  function runPrediction() {
    const league = getSelectedLeague();
    const home = elHome?.value || "";
    const away = elAway?.value || "";

    if (!league || !home || !away) {
      safeHTML(elOut, `<div class="mono">Choose league + teams, then Run.</div>`);
      safeText(elH2H, "");
      return;
    }
    if (home === away) {
      safeHTML(elOut, `<div class="mono">Home and away cannot be the same team.</div>`);
      safeText(elH2H, "");
      return;
    }

    const sims = getSims();
    const leagueXG = XG?.[league] ?? {};
    const { homeLambda, awayLambda } = deriveLambdas(leagueXG, home, away);

    // Monte Carlo
    let homeWins = 0, draws = 0, awayWins = 0;
    let over25 = 0, btts = 0;

    let sumH = 0, sumA = 0;

    const scoreMap = new Map(); // "h-a" -> count
    for (let i = 0; i < sims; i++) {
      const hg = poissonSample(homeLambda);
      const ag = poissonSample(awayLambda);

      sumH += hg; sumA += ag;

      if (hg > ag) homeWins++;
      else if (hg === ag) draws++;
      else awayWins++;

      if (hg + ag >= 3) over25++;
      if (hg >= 1 && ag >= 1) btts++;

      const key = `${hg}-${ag}`;
      scoreMap.set(key, (scoreMap.get(key) ?? 0) + 1);
    }

    const pH = homeWins / sims;
    const pD = draws / sims;
    const pA = awayWins / sims;

    const pO25 = over25 / sims;
    const pU25 = 1 - pO25;
    const pBTTS = btts / sims;

    // top scorelines
    const topScores = [...scoreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, c]) => ({ score: k, p: c / sims }));

    const mostLikely = topScores[0]?.score ?? "—";

    // fair odds
    const oh = fairOdds(pH);
    const od = fairOdds(pD);
    const oa = fairOdds(pA);
    const oo25 = fairOdds(pO25);
    const ou25 = fairOdds(pU25);
    const obtts = fairOdds(pBTTS);

    // H2H line (fix undefined)
    const h2hRec = findH2H(H2H, league, home, away);
    safeText(elH2H, h2hLine(h2hRec, home, away));

    // output
    const topLines = topScores
      .map(s => `${s.score} (${(s.p * 100).toFixed(1)}%)`)
      .join(" • ");

    safeHTML(elOut, `
      <div class="mono">
        <div><b>${league}</b></div>
        <div><b>${home}</b> vs <b>${away}</b></div>
        <hr/>
        <div>λ Home: ${toFixed2(homeLambda)} | λ Away: ${toFixed2(awayLambda)}</div>
        <div>Avg goals: ${toFixed2(sumH / sims)} - ${toFixed2(sumA / sims)} (sims: ${sims})</div>
        <div>Most likely score: <b>${mostLikely}</b></div>
        <div>Top scores: ${topLines || "—"}</div>
        <hr/>
        <div>1X2: Home ${(pH*100).toFixed(0)}% | Draw ${(pD*100).toFixed(0)}% | Away ${(pA*100).toFixed(0)}%</div>
        <div>O2.5: ${(pO25*100).toFixed(0)}% | U2.5: ${(pU25*100).toFixed(0)}% | BTTS: ${(pBTTS*100).toFixed(0)}%</div>
        <hr/>
        <div>Fair odds (decimal):</div>
        <div>Home ${toFixed2(oh)} | Draw ${toFixed2(od)} | Away ${toFixed2(oa)}</div>
        <div>O2.5 ${toFixed2(oo25)} | U2.5 ${toFixed2(ou25)} | BTTS ${toFixed2(obtts)}</div>
      </div>
    `);
  }

  // ---------- events ----------
  function onLeagueChange() {
    const league = getSelectedLeague();
    refreshTeamsDropdowns(league);
    refreshFixtureDropdown(league);
    showTodayFixtures(league);

    // reset output
    safeHTML(elOut, `<div class="mono">Choose league + teams, then Run.</div>`);
    safeText(elH2H, "");
  }

  function onFixtureChange() {
    const league = getSelectedLeague();
    const idx = Number(elFixture?.value ?? NaN);
    if (!Number.isFinite(idx) || idx < 0 || idx >= fixtureCache.length) return;
    const f = fixtureCache[idx]?.fixture;
    const { home, away } = tryAutofillFromFixture(f);

    // try to match exact team keys in xG table (by normalized name)
    const teams = leagueTeams(league);
    const map = new Map(teams.map(t => [norm(t), t]));
    const hKey = map.get(norm(home)) ?? home;
    const aKey = map.get(norm(away)) ?? away;

    // only set if exists in dropdown options
    if (elHome && teams.includes(hKey)) elHome.value = hKey;
    if (elAway && teams.includes(aKey)) elAway.value = aKey;
  }

  // Expose for your Run button (onclick="runPrediction()")
  window.runPrediction = runPrediction;

  // ---------- init ----------
  async function init() {
    safeHTML(elOut, `<div class="mono">Loading data…</div>`);
    safeText(elH2H, "");

    // Load all three files (independent; don’t crash if one fails)
    try { XG = await loadJSON("./xg_tables.json"); } catch (e) { console.warn(e); XG = null; }
    try { FIX = await loadJSON("./fixtures.json"); } catch (e) { console.warn(e); FIX = []; }
    try { H2H = await loadJSON("./h2h.json"); } catch (e) { console.warn(e); H2H = []; }

    showLoadedBadges();

    if (!XG || !Object.keys(XG).length) {
      safeHTML(elOut, `<div class="mono">ERROR: xg_tables.json not loaded. Check file name/path and GitHub Pages.</div>`);
      return;
    }

    refreshLeagueDropdown();

    // Hook events
    if (elLeague) elLeague.addEventListener("change", onLeagueChange);
    if (elFixture) elFixture.addEventListener("change", onFixtureChange);

    // default view
    safeHTML(elOut, `<div class="mono">Choose league + teams, then Run.</div>`);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
