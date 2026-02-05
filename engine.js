/* MatchQuant engine.js — OPTION B (DETERMINISTIC POISSON) — FIXED LOOKUPS */

window.runPrediction = function (p) {
  const {
    league, home, away,
    homeAdv, baseGoals, capGoals,
    xgRaw
  } = p;

  // ---------- helpers ----------
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "); // collapse spaces

  function clampInt(n, lo, hi) {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonP(k, mu) {
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  // ---------- build a case-insensitive xG index ----------
  // Supports:
  // 1) xgRaw.leagues[league][team] = {xGF,...}
  // 2) xgRaw[league][team] = {xGF,...}
  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  const leagueObj = root && root[league] ? root[league] : null;

  // Map normalized team name -> original key
  const teamKeyMap = {};
  if (leagueObj && typeof leagueObj === "object") {
    for (const k of Object.keys(leagueObj)) {
      if (!k || k.startsWith("__")) continue; // hide __league_factor etc
      teamKeyMap[norm(k)] = k;
    }
  }

  function teamXG(team) {
    const t = norm(team);
    const originalKey = teamKeyMap[t];

    const v =
      (leagueObj && originalKey && leagueObj[originalKey] && leagueObj[originalKey].xGF);

    if (typeof v === "number" && isFinite(v) && v > 0) return v;

    return Number(baseGoals || 1.35);
  }

  // ---------- inputs ----------
  const cap = clampInt(capGoals, 0, 12);
  const muHome = teamXG(home) * Number(homeAdv || 1.10);
  const muAway = teamXG(away);

  // ---------- compute probabilities ----------
  let bestScore = "0-0";
  let bestProb = -1;

  let pHomeWin = 0, pDraw = 0, pAwayWin = 0;

  const ph = [];
  const pa = [];
  for (let i = 0; i <= cap; i++) {
    ph[i] = poissonP(i, muHome);
    pa[i] = poissonP(i, muAway);
  }

  // track top 5 scorelines for sanity
  const top = [];

  for (let hg = 0; hg <= cap; hg++) {
    for (let ag = 0; ag <= cap; ag++) {
      const prob = ph[hg] * pa[ag];

      if (hg > ag) pHomeWin += prob;
      else if (hg < ag) pAwayWin += prob;
      else pDraw += prob;

      const score = `${hg}-${ag}`;
      if (prob > bestProb) {
        bestProb = prob;
        bestScore = score;
      }

      top.push([score, prob]);
    }
  }

  top.sort((a, b) => b[1] - a[1]);
  const top5 = top.slice(0, 5);

  // warn if xG missing for either team (meaning fallback baseGoals used)
  const missing = [];
  if (!teamKeyMap[norm(home)]) missing.push(home);
  if (!teamKeyMap[norm(away)]) missing.push(away);

  const missLine = missing.length
    ? `\n\n⚠️ xG missing for: ${missing.join(", ")}\nCheck team names in xg_tables.json vs fixtures.json`
    : "";

  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities (Poisson, deterministic):\n` +
    `${home}: ${(pHomeWin * 100).toFixed(1)}%\n` +
    `Draw: ${(pDraw * 100).toFixed(1)}%\n` +
    `${away}: ${(pAwayWin * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${bestScore}\n\n` +
    `xG Model (means):\n` +
    `${home}: ${muHome.toFixed(2)}\n` +
    `${away}: ${muAway.toFixed(2)}\n\n` +
    `Top 5 scorelines:\n` +
    top5.map(([s, pr]) => `${s} (${(pr * 100).toFixed(1)}%)`).join("\n") +
    missLine
  );
};
