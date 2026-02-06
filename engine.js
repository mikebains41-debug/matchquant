/* MatchQuant Engine — works with app.js (expects window.predictMatch)
   Loads:
   - ./data/xg_2025_2026.json (team attack/def + league factor)
   - ./h2h.json (optional)
*/

(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

  function buildScoreGrid(lambdaHome, lambdaAway, goalCap) {
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
        for (let a = 0; a <= cap; a++) grid[h][a] /= sum;
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
    return {
      over,
      under,
      overOdds: over > 0 ? +(1 / over).toFixed(2) : null,
      underOdds: under > 0 ? +(1 / under).toFixed(2) : null
    };
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
    return {
      yes,
      no,
      yesOdds: yes > 0 ? +(1 / yes).toFixed(2) : null,
      noOdds: no > 0 ? +(1 / no).toFixed(2) : null
    };
  }

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
    return { win, lose, fairOdds: win > 0 ? +(1 / win).toFixed(2) : null };
  }

  const fmtPct = (p) => `${(p * 100).toFixed(1)}%`;

  function h2hKey(league, home, away) {
    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    return `${norm(league)}__${norm(home)}__${norm(away)}`;
  }

  let XG = null;
  let H2H = null;

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return await res.json();
  }

  async function ensureLoaded() {
    if (!XG) XG = await loadJSON("./data/xg_2025_2026.json");
    if (!H2H) {
      try {
        H2H = await loadJSON("./h2h.json");
      } catch {
        H2H = {};
      }
    }
  }

  function predictFromTables({ league, home, away, homeAdv = 1.10, baseGoals = 1.35, goalCap = 8 }) {
    const lg = XG?.[league];
    const leagueFactor = lg?.__league_factor ?? 1.0;

    const homeRow = lg?.[home];
    const awayRow = lg?.[away];

    // Fallbacks if a team not in xg table
    const hAtt = homeRow?.att ?? 1.15;
    const hDef = homeRow?.def ?? 1.00;
    const aAtt = awayRow?.att ?? 1.15;
    const aDef = awayRow?.def ?? 1.00;

    // simple attack/def interaction
    let lamH = baseGoals * leagueFactor * homeAdv * (hAtt / aDef);
    let lamA = baseGoals * leagueFactor * (aAtt / hDef);

    lamH = clamp(lamH, 0.15, 3.5);
    lamA = clamp(lamA, 0.15, 3.5);

    const grid = buildScoreGrid(lamH, lamA, goalCap);
    const ml = mostLikelyScore(grid);
    const x12 = calc1X2(grid);
    const ou25 = calcOverUnder(grid, 2.5);
    const btts = calcBTTS(grid);
    const ahHomeMinus05 = calcAsianHandicap(grid, "home", -0.5);

    return { lamH, lamA, grid, ml, x12, ou25, btts, ahHomeMinus05 };
  }

  function renderHTML({ league, home, away, lamH, lamA, ml, x12, ou25, btts, ahHomeMinus05, h2h }) {
    const card = (title, body) => `
      <div class="card" style="margin:0 0 12px 0;">
        <div style="font-weight:800;margin-bottom:6px;">${title}</div>
        <div>${body}</div>
      </div>
    `;

    const h2hHtml = h2h
      ? `<div class="badge">Last H2H: <b>${h2h.score}</b> · Cards: <b>${h2h.cards}</b> · Corners: <b>${h2h.corners}</b> · (${h2h.date})</div>`
      : `<div class="badge">Last H2H: <b>not found</b> (no key match in h2h.json)</div>`;

    return `
      ${card(
        `${league}: ${home} vs ${away}`,
        `
        ${h2hHtml}
        <div class="kv">
          <div class="badge">λ Home: <b>${lamH.toFixed(2)}</b></div>
          <div class="badge">λ Away: <b>${lamA.toFixed(2)}</b></div>
          <div class="badge">Most likely: <b>${ml.h}-${ml.a}</b> (${fmtPct(ml.p)})</div>
        </div>
        `
      )}

      ${card(
        "1X2 (fair)",
        `
        Home: <b>${fmtPct(x12.home)}</b> (odds ~ <b>${(1 / x12.home).toFixed(2)}</b>)<br/>
        Draw: <b>${fmtPct(x12.draw)}</b> (odds ~ <b>${(1 / x12.draw).toFixed(2)}</b>)<br/>
        Away: <b>${fmtPct(x12.away)}</b> (odds ~ <b>${(1 / x12.away).toFixed(2)}</b>)
        `
      )}

      ${card(
        "Totals",
        `
        O2.5: <b>${fmtPct(ou25.over)}</b> (fair ~ <b>${ou25.overOdds}</b>)<br/>
        U2.5: <b>${fmtPct(ou25.under)}</b> (fair ~ <b>${ou25.underOdds}</b>)
        `
      )}

      ${card(
        "BTTS",
        `
        Yes: <b>${fmtPct(btts.yes)}</b> (fair ~ <b>${btts.yesOdds}</b>)<br/>
        No: <b>${fmtPct(btts.no)}</b> (fair ~ <b>${btts.noOdds}</b>)
        `
      )}

      ${card(
        "Asian Handicap (simple)",
        `
        Home -0.5 cover: <b>${fmtPct(ahHomeMinus05.win)}</b> (fair ~ <b>${ahHomeMinus05.fairOdds}</b>)
        `
      )}
    `;
  }

  // ✅ This is what app.js is looking for
  window.predictMatch = async function (payload) {
    try {
      await ensureLoaded();

      const league = payload.league;
      const home = payload.home;
      const away = payload.away;

      const homeAdv = Number(payload.homeAdv ?? 1.10);
      const baseGoals = Number(payload.baseGoals ?? 1.35);
      const goalCap = Number(payload.goalCap ?? 8);

      const { lamH, lamA, ml, x12, ou25, btts, ahHomeMinus05 } =
        predictFromTables({ league, home, away, homeAdv, baseGoals, goalCap });

      const key = h2hKey(league, home, away);
      const h2h = H2H?.[key] || null;

      return renderHTML({ league, home, away, lamH, lamA, ml, x12, ou25, btts, ahHomeMinus05, h2h });
    } catch (e) {
      return `<div class="card"><b>Engine error:</b> ${String(e.message || e)}</div>`;
    }
  };
})();
