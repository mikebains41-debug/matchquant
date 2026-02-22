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
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function keyScore(h, a) { return `${h}-${a}`; }

export function simulateMatch({
  homeXG, awayXG,
  homeAdv = 0.10,         // small home advantage in goals
  pace = 1.00,            // 1.0 default, adjust if you later model tempo
  sims = 20000,
  seed = 1337
}) {
  const rng = mulberry32(seed);

  const lamH = clamp((Number(homeXG) + homeAdv) * pace, 0.05, 6.0);
  const lamA = clamp(Number(awayXG) * pace, 0.05, 6.0);

  let homeW = 0, draw = 0, awayW = 0;
  let over25 = 0, btts = 0;

  const scoreCounts = new Map();
  const totals = [];

  for (let i = 0; i < sims; i++) {
    const h = poissonSample(lamH, rng);
    const a = poissonSample(lamA, rng);

    if (h > a) homeW++;
    else if (h === a) draw++;
    else awayW++;

    if (h + a >= 3) over25++;
    if (h >= 1 && a >= 1) btts++;

    totals.push(h + a);

    const k = keyScore(h, a);
    scoreCounts.set(k, (scoreCounts.get(k) || 0) + 1);
  }

  // top scorelines
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
    totals // keep for flexible total/alt lines
  };
}

export function probOverTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L)) return null;
  // Basketball totals are integer or .5, soccer totals are .5 etc.
  // We interpret "Over 207.0" as total >= 208 (strictly greater than 207)
  // For .5 lines, total > line works naturally.
  let over = 0;
  for (const t of totalsArr) {
    if (t > L) over++;
  }
  return over / totalsArr.length;
}

export function probUnderTotal(totalsArr, line) {
  const L = Number(line);
  if (!isFinite(L)) return null;
  let under = 0;
  for (const t of totalsArr) {
    if (t < L) under++;
  }
  return under / totalsArr.length;
}

export function probAHCover({ results, ah }) {
  // results: array of {h,a} OR totals? (for soccer we use goals)
  // Here we assume you pass in per-sim (h,a) but we currently store totals only.
  // We'll compute AH on scoreline distribution approximation from topScores not perfect.
  // For soccer app this can be expanded; for now v2 focuses on 1X2 + totals.
  return null;
}

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
