// engine.js — MatchQuant 2 core (offline)
// Browser-safe, no dependencies.
// Exposes window.MQ2.analyzeMatch() for app.js.

export function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

export function oddsToImplied(odds) {
  const o = Number(odds);
  if (!isFinite(o) || o <= 1.0) return null;
  return 1 / o;
}

export function americanToDecimal(am) {
  const a = Number(am);
  if (!isFinite(a) || a === 0) return null;
  if (a > 0) return 1 + (a / 100);
  return 1 + (100 / Math.abs(a));
}

export function removeVigTwoWay(pA, pB) {
  if (pA == null || pB == null) return null;
  const s = pA + pB;
  if (s <= 0) return null;
  return [pA / s, pB / s];
}

export function removeVigThreeWay(pH, pD, pA) {
  if (pH == null || pD == null || pA == null) return null;
  const s = pH + pD + pA;
  if (s <= 0) return null;
  return [pH / s, pD / s, pA / s];
}

function poissonSample(lambda, rng) {
  // Knuth method
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function keyScore(h, a) { return `${h}-${a}`; }

function safeNum(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

function getTeamAttackXG(xgTables, league, team) {
  // Accepts lots of formats:
  // - xgTables[league][team] = number
  // - xgTables[league][team] = { xg: 1.6 } or { xGF: 1.6 } or { for: 1.6 }
  const node = xgTables?.[league]?.[team];
  if (node == null) return null;
  if (typeof node === "number") return node;
  if (typeof node === "object") {
    return (
      safeNum(node.xg, NaN) ||
      safeNum(node.xGF, NaN) ||
      safeNum(node.xg_for, NaN) ||
      safeNum(node.for, NaN) ||
      safeNum(node.attack, NaN) ||
      safeNum(node.att, NaN) ||
      NaN
    );
  }
  return null;
}

function getTeamDefenseXGA(xgTables, league, team) {
  // Optional. If not present we fall back to league average.
  const node = xgTables?.[league]?.[team];
  if (node == null) return null;
  if (typeof node === "object") {
    return (
      safeNum(node.xga, NaN) ||
      safeNum(node.xGA, NaN) ||
      safeNum(node.xg_against, NaN) ||
      safeNum(node.against, NaN) ||
      safeNum(node.defense, NaN) ||
      safeNum(node.def, NaN) ||
      NaN
    );
  }
  return null;
}

function leagueAverages(xgTables, league) {
  const teams = xgTables?.[league] || {};
  const names = Object.keys(teams);
  if (!names.length) return { avgXG: 1.25, avgXGA: 1.25 };

  let sXG = 0, cXG = 0;
  let sXGA = 0, cXGA = 0;

  for (const t of names) {
    const axg = getTeamAttackXG(xgTables, league, t);
    if (axg != null && Number.isFinite(axg)) { sXG += axg; cXG++; }

    const xga = getTeamDefenseXGA(xgTables, league, t);
    if (xga != null && Number.isFinite(xga)) { sXGA += xga; cXGA++; }
  }

  return {
    avgXG: cXG ? (sXG / cXG) : 1.25,
    avgXGA: cXGA ? (sXGA / cXGA) : 1.25
  };
}

/**
 * ✅ simulateMatch — CORRECT
 * Returns:
 * - probs: 1X2 + over25 + BTTS
 * - topScores: top 8 scorelines
 * - totals: totals array (for totals lines)
 * - results: array of [h,a] (for AH + anything else)
 */
export function simulateMatch({
  homeXG, awayXG,
  homeAdv = 0.10,
  pace = 1.00,
  sims = 20000,
  seed = 1337
}) {
  const rng = mulberry32(seed);

  const lamH = clamp((Number(homeXG) + homeAdv) * pace, 0.05, 6.0);
  const lamA = clamp(Number(awayXG) * pace, 0.05, 6.0);

  let homeW = 0, draw = 0, awayW = 0;
  let over25 = 0, btts = 0;

  const scoreCounts = new Map();
  const totals = new Array(sims);
  const results = new Array(sims);

  for (let i = 0; i < sims; i++) {
    const h = poissonSample(lamH, rng);
    const a = poissonSample(lamA, rng);

    results[i] = [h, a];
    totals[i] = h + a;

    if (h > a) homeW++;
    else if (h === a) draw++;
    else awayW++;

    if (h + a >= 3) over25++;
    if (h >= 1 && a >= 1) btts++;

    const k = keyScore(h, a);
    scoreCounts.set(k, (scoreCounts.get(k) || 0) + 1);
  }

  const topScores = [...scoreCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
    .map(([score, n]) => {
      const [hh, aa] = score.split("-").map(Number);
      return { h: hh, a: aa, score, pct: n / sims };
    });

  return {
    params: { lamH, lamA, sims, seed },
    probs: {
      homeW: homeW / sims,
      draw: draw / sims,
      awayW: awayW / sims,
      over25: over25 / sims,
      btts: btts / sims
    },
    topScores,
    totals,
    results
  };
}

/**
 * ✅ probOverTotal — CORRECT
 * Over X = total > X  (works for 2.5, 3.0, etc)
 */
export function probOverTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L) || !totalsArr?.length) return null;
  let over = 0;
  for (const t of totalsArr) if (t > L) over++;
  return over / totalsArr.length;
}

/**
 * ✅ probUnderTotal — CORRECT
 * Under X = total < X
 */
export function probUnderTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L) || !totalsArr?.length) return null;
  let under = 0;
  for (const t of totalsArr) if (t < L) under++;
  return under / totalsArr.length;
}

// --- Asian Handicap helpers (supports .0, .25, .5, .75, 1.0 etc) ---

function splitQuarter(line) {
  // returns array of component lines for quarter-handicaps
  // e.g. -0.25 => [0, -0.5]
  //      +0.75 => [+0.5, +1.0]
  const L = Number(line);
  const frac = Math.abs(L % 1);
  if (frac === 0.25) return [L + 0.25, L - 0.25];
  if (frac === 0.75) return [L + 0.25, L - 0.25];
  return [L];
}

function ahSingleOutcome(diff, line) {
  // diff = homeGoals - awayGoals
  // returns: "W" (win), "P" (push), "L" (loss)
  const adj = diff + Number(line);
  if (adj > 0) return "W";
  if (adj === 0) return "P";
  return "L";
}

/**
 * ✅ probAHCover — CORRECT
 * Returns profit-weighted probability for Home and Away (and push rate if needed)
 * - input "ah" is Home line (e.g. -0.5 means Home -0.5)
 * - results is array of [h,a]
 */
export function probAHCover({ results, ah }) {
  const line = Number(ah);
  if (!isFinite(line) || !results?.length) return null;

  const parts = splitQuarter(line); // one line or two lines
  const partsAway = parts.map(p => -p);

  let homeProfit = 0;
  let awayProfit = 0;

  // Also track push-ish (for display/debug if you want later)
  let homePush = 0;
  let awayPush = 0;

  for (const [h, a] of results) {
    const diff = h - a;

    // Home
    if (parts.length === 1) {
      const o = ahSingleOutcome(diff, parts[0]);
      if (o === "W") homeProfit += 1;
      else if (o === "P") homePush += 1;
    } else {
      // half stake on each part
      const o1 = ahSingleOutcome(diff, parts[0]);
      const o2 = ahSingleOutcome(diff, parts[1]);
      // profit-weighted (W=1, P=0, L=0) but half stake each
      homeProfit += 0.5 * (o1 === "W" ? 1 : 0) + 0.5 * (o2 === "W" ? 1 : 0);
      homePush += 0.5 * (o1 === "P" ? 1 : 0) + 0.5 * (o2 === "P" ? 1 : 0);
    }

    // Away
    if (partsAway.length === 1) {
      const o = ahSingleOutcome(-diff, partsAway[0]); // away perspective
      if (o === "W") awayProfit += 1;
      else if (o === "P") awayPush += 1;
    } else {
      const o1 = ahSingleOutcome(-diff, partsAway[0]);
      const o2 = ahSingleOutcome(-diff, partsAway[1]);
      awayProfit += 0.5 * (o1 === "W" ? 1 : 0) + 0.5 * (o2 === "W" ? 1 : 0);
      awayPush += 0.5 * (o1 === "P" ? 1 : 0) + 0.5 * (o2 === "P" ? 1 : 0);
    }
  }

  const n = results.length;
  return {
    pHome: homeProfit / n,
    pAway: awayProfit / n,
    pHomePush: homePush / n,
    pAwayPush: awayPush / n
  };
}

export function evEdge(modelProb, offeredOddsDecimal) {
  const p = Number(modelProb);
  const o = Number(offeredOddsDecimal);
  if (!isFinite(p) || !isFinite(o) || o <= 1.0) return null;
  return p * (o - 1) - (1 - p);
}

export function tierFromEdge(edge, confidence = 0.5) {
  if (edge == null) return { tier: "NO BET", note: "Missing odds / inputs" };
  const adj = edge * (0.75 + 0.5 * clamp(confidence, 0, 1));
  if (adj >= 0.06) return { tier: "TIER 1", note: "Strong +EV" };
  if (adj >= 0.025) return { tier: "TIER 2", note: "Moderate +EV" };
  if (adj > 0.0) return { tier: "TIER 3", note: "Small +EV / lean" };
  return { tier: "NO BET", note: "Negative EV" };
}

// -------------------- MAIN API FOR APP --------------------

function fairOddsFromProb(p) {
  if (p == null || !isFinite(p) || p <= 0) return null;
  return 1 / p;
}

export function analyzeMatch({
  league, homeTeam, awayTeam,
  tables,
  options = {}
}) {
  try {
    if (!league || !homeTeam || !awayTeam) {
      return { error: "Pick a league + teams and hit Run Prediction." };
    }

    const leagues = tables?.leagues || {};
    const xgTables = tables?.xg || {};
    const h2h = tables?.h2h || {};

    const leagueCfg = leagues?.[league] || {};
    const homeAdv = safeNum(leagueCfg.home_adv, 0.10);
    const pace = safeNum(leagueCfg.pace, 1.00);

    const { avgXG, avgXGA } = leagueAverages(xgTables, league);

    const hAtk = getTeamAttackXG(xgTables, league, homeTeam);
    const aAtk = getTeamAttackXG(xgTables, league, awayTeam);

    // If you have defense xGA in your tables, we blend it in lightly
    const hDef = getTeamDefenseXGA(xgTables, league, homeTeam);
    const aDef = getTeamDefenseXGA(xgTables, league, awayTeam);

    // Fallback if formats don’t include defense
    const homeBase = Number.isFinite(hAtk) ? hAtk : avgXG;
    const awayBase = Number.isFinite(aAtk) ? aAtk : avgXG;

    const awayDefBase = Number.isFinite(aDef) ? aDef : avgXGA;
    const homeDefBase = Number.isFinite(hDef) ? hDef : avgXGA;

    // Simple blend: attack vs opponent defense around league average
    // If defense not present, this reduces to attack value.
    const lamH = clamp(homeBase * (awayDefBase / avgXGA), 0.2, 5.0);
    const lamA = clamp(awayBase * (homeDefBase / avgXGA), 0.2, 5.0);

    const sims = safeNum(options.sims, 20000);
    const seed = safeNum(options.seed, 1337);

    const sim = simulateMatch({
      homeXG: lamH,
      awayXG: lamA,
      homeAdv,
      pace,
      sims,
      seed
    });

    // Most likely scoreline:
    const bestScore = sim.topScores?.[0] || { h: 1, a: 1, pct: 0.0 };

    const expHome = sim.params.lamH;
    const expAway = sim.params.lamA;
    const expTotal = expHome + expAway;

    // Totals
    const ouLine = Number.isFinite(Number(options.ouLine)) ? Number(options.ouLine) : null;
    const pOver = ouLine != null ? probOverTotal(sim.totals, ouLine) : null;
    const pUnder = ouLine != null ? probUnderTotal(sim.totals, ouLine) : null;

    // AH
    const ahLine = Number.isFinite(Number(options.ahLine)) ? Number(options.ahLine) : null;
    const ah = ahLine != null ? probAHCover({ results: sim.results, ah: ahLine }) : null;

    // 1X2
    const pHome = sim.probs.homeW;
    const pDraw = sim.probs.draw;
    const pAway = sim.probs.awayW;

    // Fair odds
    const fairOdds = {
      home: fairOddsFromProb(pHome),
      draw: fairOddsFromProb(pDraw),
      away: fairOddsFromProb(pAway),
      over: pOver != null ? fairOddsFromProb(pOver) : null,
      under: pUnder != null ? fairOddsFromProb(pUnder) : null
    };

    // Market comparison (from your entered 1X2 odds)
    const oddsH = safeNum(options.oddsH, NaN);
    const oddsD = safeNum(options.oddsD, NaN);
    const oddsA = safeNum(options.oddsA, NaN);

    let market = null;
    let edges = null;

    if (Number.isFinite(oddsH) && Number.isFinite(oddsD) && Number.isFinite(oddsA)) {
      const iH = oddsToImplied(oddsH);
      const iD = oddsToImplied(oddsD);
      const iA = oddsToImplied(oddsA);
      const nv = removeVigThreeWay(iH, iD, iA);
      if (nv) {
        market = { noVig: { pH: nv[0], pD: nv[1], pA: nv[2] } };
        // Edge here = modelProb - marketNoVigProb (shown as % in UI)
        edges = {
          home: pHome - nv[0],
          draw: pDraw - nv[1],
          away: pAway - nv[2]
        };
      }
    }

    return {
      inputs: {
        league,
        homeTeam,
        awayTeam,
        lamH: sim.params.lamH,
        lamA: sim.params.lamA,
        pace
      },
      model: {
        expHome,
        expAway,
        expTotal,
        bestScore: { h: bestScore.h, a: bestScore.a, p: bestScore.pct },
        pHome,
        pDraw,
        pAway,
        pOver,
        pUnder,
        pAHHome: ah ? ah.pHome : null,
        pAHAway: ah ? ah.pAway : null
      },
      fairOdds,
      market,
      edges
    };

  } catch (e) {
    return { error: String(e) };
  }
}

// Make it available for non-module calls if needed
if (typeof window !== "undefined") {
  window.MQ2 = window.MQ2 || {};
  window.MQ2.analyzeMatch = analyzeMatch;
}
