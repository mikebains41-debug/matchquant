/* MatchQuant engine.js — WORKING engine (Poisson + markets)
   Exposes: window.predictMatch(payload)
   Loads:
     ./data/teams.json
     ./data/xg_2025_2026.json
     ./data/league_strength.json (optional)
     ./data/aliases.json (optional)
     ./h2h.json (optional)
*/

(() => {
  // ---------- helpers ----------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const fairOdds = (p) => (p > 0 ? +(1 / p).toFixed(2) : null);

  function factorial(n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }

  function buildScoreGrid(lambdaHome, lambdaAway, goalCap = 8) {
    const cap = clamp(parseInt(goalCap || 8, 10), 4, 12);
    const grid = {};
    let sum = 0;

    for (let h = 0; h <= cap; h++) {
      grid[h] = {};
      const ph = poissonPMF(h, lambdaHome);
      for (let a = 0; a <= cap; a++) {
        const pa = poissonPMF(a, lambdaAway);
        const p = ph * pa;
        grid[h][a] = p;
        sum += p;
      }
    }

    if (sum > 0) {
      for (let h = 0; h <= cap; h++) {
        for (let a = 0; a <= cap; a++) {
          grid[h][a] /= sum;
        }
      }
    }
    return grid;
  }

  function mostLikelyScore(scoreGrid) {
    let best = { h: 0, a: 0, p: -1 };
    for (const hStr of Object.keys(scoreGrid)) {
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const p = row[aStr];
        if (p > best.p) best = { h: Number(hStr), a: Number(aStr), p };
      }
    }
    return best;
  }

  function calc1X2(scoreGrid) {
    let home = 0, draw = 0, away = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > a) home += p;
        else if (h === a) draw += p;
        else away += p;
      }
    }
    return { home, draw, away };
  }

  function calcOverUnder(scoreGrid, line = 2.5) {
    let over = 0, under = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const total = h + a;
        if (total > line) over += p;
        else under += p;
      }
    }
    return { over, under, overOdds: fairOdds(over), underOdds: fairOdds(under) };
  }

  function calcBTTS(scoreGrid) {
    let yes = 0, no = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        if (h > 0 && a > 0) yes += p;
        else no += p;
      }
    }
    return { yes, no, yesOdds: fairOdds(yes), noOdds: fairOdds(no) };
  }

  // Simple AH cover prob (no pushes handling for quarters)
  function calcAsianHandicap(scoreGrid, side = "home", line = -0.5) {
    let win = 0, lose = 0;
    for (const hStr of Object.keys(scoreGrid)) {
      const h = Number(hStr);
      const row = scoreGrid[hStr];
      for (const aStr of Object.keys(row)) {
        const a = Number(aStr);
        const p = row[aStr];
        const diff = h - a;
        const adj = side === "home" ? (diff + line) : ((-diff) + line);
        if (adj > 0) win += p;
        else lose += p;
      }
    }
    return { win, lose, fairOdds: fairOdds(win) };
  }

  // ---------- data loading ----------
  const state = {
    ready: false,
    teamsByLeague: null,
    xg: null,
    leagueStrength: null,
    aliases: null,
    h2h: null,
    err: null,
  };

  function normKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s-]/g, "");
  }

  function canonicalTeamName(teamName) {
    // If aliases.json exists, map inputs -> canonical
    if (!state.aliases) return teamName;
    const k = normKey(teamName);
    return state.aliases[k] || teamName;
  }

  function h2hKey(league, home, away) {
    // matches your h2h.json style:
    // "premier league__arsenal__aston villa"
    return `${normKey(league)}__${normKey(home)}__${normKey(away)}`;
  }

  async function tryFetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return await res.json();
  }

  async function loadAll() {
    try {
      state.teamsByLeague = await tryFetchJson("./data/teams.json");
      // main model tables
      state.xg = await tryFetchJson("./data/xg_2025_2026.json");

      // optional files — don’t crash if missing
      try { state.leagueStrength = await tryFetchJson("./data/league_strength.json"); } catch (_) {}
      try { state.aliases = await tryFetchJson("./data/aliases.json"); } catch (_) {}
      try { state.h2h = await tryFetchJson("./h2h.json"); } catch (_) {}

      state.ready = true;
    } catch (e) {
      state.err = e;
      state.ready = false;
      console.error("Engine load error:", e);
    }
  }

  const loadPromise = loadAll();

  // ---------- core expected goals ----------
  function getLeagueFactor(leagueName) {
    // Prefer xG table league factor if present
    const L = state.xg?.[leagueName];
    if (L && typeof L.__league_factor === "number") return L.__league_factor;

    // Optional: league_strength.json could have factors
    const LS = state.leagueStrength?.[leagueName];
    if (LS && typeof LS.leagueFactor === "number") return LS.leagueFactor;

    return 1.0;
  }

  function getTeamAttDef(leagueName, teamName) {
    const L = state.xg?.[leagueName];
    if (!L) return null;
    const t = L[teamName];
    if (!t || typeof t.att !== "number" || typeof t.def !== "number") return null;
    return t;
  }

  function expectedGoals({
    league,
    home,
    away,
    baseGoals = 1.35,
    homeAdv = 1.1
  }) {
    const leagueFactor = getLeagueFactor(league);

    const hTeam = getTeamAttDef(league, home);
    const aTeam = getTeamAttDef(league, away);

    // If missing team rows, fall back to neutral
    const hAtt = hTeam?.att ?? 1.0;
    const hDef = hTeam?.def ?? 1.0;
    const aAtt = aTeam?.att ?? 1.0;
    const aDef = aTeam?.def ?? 1.0;

    // Simple stable model:
    // Home goals ~ base * leagueFactor * homeAdv * (home att) * (away def)
    // Away goals ~ base * leagueFactor * (away att) * (home def)
    let lamH = baseGoals * leagueFactor * homeAdv * hAtt * aDef;
    let lamA = baseGoals * leagueFactor * aAtt * hDef;

    // keep sane
    lamH = clamp(lamH, 0.15, 3.6);
    lamA = clamp(lamA, 0.15, 3.6);

    return { lamH, lamA, leagueFactor };
  }

  // ---------- UI output ----------
  function renderResult({ league, home, away, lamH, lamA, top, x12, ou25, btts, ah, h2hRow }) {
    const homeOdds = fairOdds(x12.home);
    const drawOdds = fairOdds(x12.draw);
    const awayOdds = fairOdds(x12.away);

    const lean1x2 =
      x12.home > x12.away && x12.home > x12.draw ? `${home} (Home)` :
      x12.away > x12.home && x12.away > x12.draw ? `${away} (Away)` :
      "Draw";

    const ouLean = ou25.over >= ou25.under ? "Over 2.5" : "Under 2.5";
    const bttsLean = btts.yes >= btts.no ? "BTTS Yes" : "BTTS No";

    const h2hHtml = h2hRow
      ? `<div class="badge">Last H2H: <b>${h2hRow.score}</b> • Cards: <b>${h2hRow.cards}</b> • Corners: <b>${h2hRow.corners}</b> • ${h2hRow.date}</div>`
      : `<div class="badge" style="opacity:.75">Last H2H: not found in h2h.json</div>`;

    return `
      <div class="card">
        <div style="font-size:18px;font-weight:800;margin-bottom:6px">${league}</div>
        <div style="font-size:16px;margin-bottom:10px"><b>${home}</b> vs <b>${away}</b></div>

        <div class="kv">
          <div class="badge">λ Home: <b>${lamH.toFixed(2)}</b></div>
          <div class="badge">λ Away: <b>${lamA.toFixed(2)}</b></div>
          <div class="badge">Most likely: <b>${top.h}-${top.a}</b> (${pct(top.p)})</div>
        </div>

        <div style="margin-top:12px;font-weight:700">1X2</div>
        <div class="kv">
          <div class="badge">${home}: <b>${pct(x12.home)}</b> • Fair <b>${homeOdds}</b></div>
          <div class="badge">Draw: <b>${pct(x12.draw)}</b> • Fair <b>${drawOdds}</b></div>
          <div class="badge">${away}: <b>${pct(x12.away)}</b> • Fair <b>${awayOdds}</b></div>
          <div class="badge">Lean: <b>${lean1x2}</b></div>
        </div>

        <div style="margin-top:12px;font-weight:700">Totals</div>
        <div class="kv">
          <div class="badge">Over 2.5: <b>${pct(ou25.over)}</b> • Fair <b>${ou25.overOdds}</b></div>
          <div class="badge">Under 2.5: <b>${pct(ou25.under)}</b> • Fair <b>${ou25.underOdds}</b></div>
          <div class="badge">Lean: <b>${ouLean}</b></div>
        </div>

        <div style="margin-top:12px;font-weight:700">BTTS</div>
        <div class="kv">
          <div class="badge">Yes: <b>${pct(btts.yes)}</b> • Fair <b>${btts.yesOdds}</b></div>
          <div class="badge">No: <b>${pct(btts.no)}</b> • Fair <b>${btts.noOdds}</b></div>
          <div class="badge">Lean: <b>${bttsLean}</b></div>
        </div>

        <div style="margin-top:12px;font-weight:700">Asian Handicap (simple)</div>
        <div class="kv">
          <div class="badge">Home -0.5 cover: <b>${pct(ah.win)}</b> • Fair <b>${ah.fairOdds}</b></div>
          <div class="badge">Lean: <b>${ah.win >= 0.5 ? `${home} -0.5` : `${away} +0.5`}</b></div>
        </div>

        <div style="margin-top:12px">${h2hHtml}</div>
      </div>
    `;
  }

  // ---------- exposed function (sync) ----------
  window.predictMatch = (payload) => {
    // app.js calls this synchronously
    if (!state.ready) {
      if (state.err) {
        return `<div class="card"><b>Engine load failed:</b><br>${String(state.err.message || state.err)}</div>`;
      }
      return `<div class="card">Loading engine data… try again in 2 seconds.</div>`;
    }

    const league = payload.league;
    let home = canonicalTeamName(payload.home);
    let away = canonicalTeamName(payload.away);

    // Inputs from index.html
    const homeAdv = clamp(Number(document.getElementById("homeAdv")?.value || 1.1), 1.0, 1.25);
    const baseGoals = clamp(Number(document.getElementById("baseGoals")?.value || 1.35), 0.9, 1.8);
    const goalCap = clamp(Number(document.getElementById("goalCap")?.value || 8), 4, 12);

    const { lamH, lamA } = expectedGoals({ league, home, away, baseGoals, homeAdv });

    const grid = buildScoreGrid(lamH, lamA, goalCap);
    const top = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);
    const ah = calcAsianHandicap(grid, "home", -0.5);

    // H2H lookup if h2h.json exists
    let h2hRow = null;
    if (state.h2h) {
      const k = h2hKey(league, home, away);
      h2hRow = state.h2h[k] || null;
    }

    return renderResult({ league, home, away, lamH, lamA, top, x12, ou25, btts, ah, h2hRow });
  };

  // optional: for debugging
  window.MQ_ENGINE_STATE = state;
  window.MQ_ENGINE_LOADED = loadPromise;
})();
