/* MatchQuant engine.js — SEEDED + POISSON (stable results) */

window.runPrediction = function (p) {
  const {
    league, home, away,
    sims, homeAdv, baseGoals, capGoals,
    xg
  } = p;

  // ---------- deterministic seed (same inputs => same results) ----------
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Mulberry32 PRNG
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const seed = hashStr(
    `${league}|${home}|${away}|${sims}|${homeAdv}|${baseGoals}|${capGoals}`
  );
  const rand = mulberry32(seed);

  // ---------- xG lookup ----------
  function teamXG(team) {
    const v = xg?.[league]?.[team]?.xGF;
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : baseGoals;
  }

  const muHome = teamXG(home) * homeAdv;
  const muAway = teamXG(away);

  // ---------- Poisson sampler (more realistic than uniform) ----------
  function poisson(mu) {
    // Knuth algorithm
    const L = Math.exp(-mu);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  }

  let scoreCounts = {};
  let hw = 0, dr = 0, aw = 0;

  for (let i = 0; i < sims; i++) {
    const hg = Math.min(capGoals, poisson(muHome));
    const ag = Math.min(capGoals, poisson(muAway));

    const key = `${hg}-${ag}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;

    if (hg > ag) hw++;
    else if (hg < ag) aw++;
    else dr++;
  }

  const bestScore = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities:\n` +
    `${home}: ${(hw / sims * 100).toFixed(1)}%\n` +
    `Draw: ${(dr / sims * 100).toFixed(1)}%\n` +
    `${away}: ${(aw / sims * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${bestScore}\n\n` +
    `xG Model (means):\n${home}: ${muHome.toFixed(2)}\n${away}: ${muAway.toFixed(2)}`
  );
};
