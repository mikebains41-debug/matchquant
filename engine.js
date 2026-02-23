// engine.js — MatchQuant 2.0 core simulation + edge detection
// No dependencies. Safe in browser.

export function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

export function oddsToImplied(odds) {
  // accepts decimal odds (>1.01). returns implied probability (no vig removal here)
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
  // normalize to 1.0
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

// ------------------------------------------------------------
// 1) Core simulation
// - Returns totals[] and diffs[] so totals + AH are exact
// - Keeps scoreCounts for top scorelines
// ------------------------------------------------------------
export function simulateMatch({
  homeXG, awayXG,
  homeAdv = 0.10,     // small home advantage in goals
  pace = 1.00,        // 1.0 default, adjust if you later model tempo
  sims = 20000,
  seed = 1337
}) {
  const rng = mulberry32(seed);

  const lamH = clamp((Number(homeXG) + homeAdv) * pace, 0.05, 6.0);
  const lamA = clamp(Number(awayXG) * pace, 0.05, 6.0);

  let homeW = 0, draw = 0, awayW = 0;
  let over25 = 0, btts = 0;

  const scoreCounts = new Map();

  // Use typed arrays for speed + smaller memory
  const totals = new Int16Array(sims); // h+a
  const diffs  = new Int16Array(sims); // h-a

  for (let i = 0; i < sims; i++) {
    const h = poissonSample(lamH, rng);
    const a = poissonSample(lamA, rng);

    const d = h - a;
    const t = h + a;

    diffs[i] = d;
    totals[i] = t;

    if (d > 0) homeW++;
    else if (d === 0) draw++;
    else awayW++;

    if (t >= 3) over25++;
    if (h >= 1 && a >= 1) btts++;

    const k = keyScore(h, a);
    scoreCounts.set(k, (scoreCounts.get(k) || 0) + 1);
  }

  const topScores = [...scoreCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
    .map(([score, n]) => ({ score, pct: n / sims }));

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
    diffs,
    scoreCounts
  };
}

// ------------------------------------------------------------
// 2) Totals probability with push support
// - For line 207.0, equality is PUSH
// - For 207.5, push will be 0 naturally
// ------------------------------------------------------------
export function probOverTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L) || !totalsArr || totalsArr.length === 0) return null;

  let win = 0, push = 0;
  for (const t of totalsArr) {
    if (t > L) win++;
    else if (t === L) push++;
  }
  const n = totalsArr.length;
  return { win: win / n, push: push / n, lose: 1 - (win / n) - (push / n) };
}

export function probUnderTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L) || !totalsArr || totalsArr.length === 0) return null;

  let win = 0, push = 0;
  for (const t of totalsArr) {
    if (t < L) win++;
    else if (t === L) push++;
  }
  const n = totalsArr.length;
  return { win: win / n, push: push / n, lose: 1 - (win / n) - (push / n) };
}

// ------------------------------------------------------------
// 3) Asian Handicap cover probability (home perspective)
// Input:
//   diffs = (homeGoals - awayGoals) per simulation (Int16Array ok)
//   ah    = handicap on HOME team (e.g. -0.25, +0.5, +1.0)
// Output:
//   { win, push, lose } probabilities
// Supports quarter lines by splitting (e.g. -0.25 => -0.0 and -0.5)
// ------------------------------------------------------------
function splitAH(ah) {
  const x = Number(ah);
  if (!isFinite(x)) return [null, null];

  const frac = Math.abs(x % 1);
  const sign = x < 0 ? -1 : 1;

  // Quarter lines split into two adjacent half-lines
  if (Math.abs(frac - 0.25) < 1e-9) return [x - 0.25 * sign, x + 0.25 * sign];
  if (Math.abs(frac - 0.75) < 1e-9) return [x - 0.25 * sign, x + 0.25 * sign];

  // Whole or half lines
  return [x, null];
}

function settleSingleAH(diff, line) {
  // diff = home-away, line is home handicap
  const v = diff + line;
  if (v > 0) return 1;    // win
  if (v === 0) return 0;  // push
  return -1;              // lose
}

export function probAHCover({ diffs, ah }) {
  if (!diffs || typeof diffs.length !== "number" || diffs.length === 0) return null;

  const [a1, a2] = splitAH(ah);
  if (a1 == null) return null;

  let win = 0, push = 0, lose = 0;

  for (const d of diffs) {
    const r1 = settleSingleAH(d, a1);
    const r2 = (a2 == null) ? null : settleSingleAH(d, a2);

    // If split, average the two legs (half-stake each)
    const outcome = (r2 == null) ? r1 : (r1 + r2) / 2;

    if (outcome > 0) win++;
    else if (outcome === 0) push++;
    else lose++;
  }

  const n = diffs.length;
  return { win: win / n, push: push / n, lose: lose / n };
}

// ------------------------------------------------------------
// EV + tiering helpers
// ------------------------------------------------------------
export function evEdge(modelProb, offeredOddsDecimal) {
  const p = Number(modelProb);
  const o = Number(offeredOddsDecimal);
  if (!isFinite(p) || !isFinite(o) || o <= 1.0) return null;
  // Expected value on $1 stake: p*(o-1) - (1-p)
  return p * (o - 1) - (1 - p);
}

export function tierFromEdge(edge, confidence = 0.5) {
  // edge = EV per $1 (e.g. 0.05 = +5% ROI)
  // confidence 0..1
  if (edge == null) return { tier: "NO BET", note: "Missing odds / inputs" };
  const adj = edge * (0.75 + 0.5 * clamp(confidence, 0, 1));

  if (adj >= 0.06) return { tier: "TIER 1", note: "Strong +EV" };
  if (adj >= 0.025) return { tier: "TIER 2", note: "Moderate +EV" };
  if (adj > 0.0) return { tier: "TIER 3", note: "Small +EV / lean" };
  return { tier: "NO BET", note: "Negative EV" };
}
