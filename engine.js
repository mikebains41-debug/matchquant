/* MatchQuant engine.js — FIXED: robust team-name matching + deterministic Poisson outputs */

window.runPrediction = function (p) {
  const { league, home, away, homeAdv, baseGoals, capGoals, xgRaw } = p;

  // ---------- normalize helpers ----------
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ");

  const clampInt = (n, lo, hi) => {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  };

  // ---------- Poisson ----------
  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  function poissonP(k, mu) {
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  // ---------- build xG index ----------
  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  const leagueObj = root && root[league] ? root[league] : null;

  // map normalized->original key
  const teamKeyMap = {};
  if (leagueObj && typeof leagueObj === "object") {
    for (const k of Object.keys(leagueObj)) {
      if (!k || k.startsWith("__")) continue;
      teamKeyMap[norm(k)] = k;
    }
  }

  // alias table (add more anytime)
  const ALIASES = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "tottenham hotspur": "tottenham",
    "wolves": "wolverhampton wanderers",
    "newcastle": "newcastle united",
    "brighton": "brighton",
    "real madrid": "real madrid",
    "atletico madrid": "atletico madrid",
  };

  function resolveTeamKey(team) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];

    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];

    // fallback: fuzzy contains match (last resort)
    const keys = Object.keys(teamKeyMap);
    const hit = keys.find(k => k.includes(n) || n.includes(k));
    return hit ? teamKeyMap[hit] : null;
  }

  function teamXG(team) {
    const key = resolveTeamKey(team);
    const v = key ? leagueObj?.[key]?.xGF : undefined;
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : Number(baseGoals || 1.35);
  }

  // ---------- inputs ----------
  const cap = clampInt(capGoals, 0, 12);
  const muHome = teamXG(home) * Number(homeAdv || 1.10);
  const muAway = teamXG(away);

  // ---------- grid ----------
  const ph = [], pa = [];
  for (let i = 0; i <= cap; i++) {
    ph[i] = poissonP(i, muHome);
    pa[i] = poissonP(i, muAway);
  }

  let bestScore = "0-0", bestProb = -1;
  let pW = 0, pD = 0, pL = 0;
  let pOver25 = 0, pUnder25 = 0;
  let pBTTS = 0;

  const top = [];

  for (let hg = 0; hg <= cap; hg++) {
    for (let ag = 0; ag <= cap; ag++) {
      const prob = ph[hg] * pa[ag];
      top.push([`${hg}-${ag}`, prob]);

      if (prob > bestProb) { bestProb = prob; bestScore = `${hg}-${ag}`; }

      if (hg > ag) pW += prob;
      else if (hg < ag) pL += prob;
      else pD += prob;

      if (hg + ag >= 3) pOver25 += prob;
      else pUnder25 += prob;

      if (hg >= 1 && ag >= 1) pBTTS += prob;
    }
  }

  top.sort((a, b) => b[1] - a[1]);
  const top5 = top.slice(0, 5).map(([s, pr]) => `${s} (${(pr * 100).toFixed(1)}%)`).join("\n");

  // show if still missing
  const miss = [];
  if (!resolveTeamKey(home)) miss.push(home);
  if (!resolveTeamKey(away)) miss.push(away);

  const missLine = miss.length
    ? `\n\n⚠️ Still missing xG for: ${miss.join(", ")}\n(Your xg_tables.json uses different team names.)`
    : "";

  alert(
    `MatchQuant says\n\n` +
    `${home} vs ${away}\n\n` +
    `Win Probabilities (Poisson, deterministic):\n` +
    `${home}: ${(pW * 100).toFixed(1)}%\n` +
    `Draw: ${(pD * 100).toFixed(1)}%\n` +
    `${away}: ${(pL * 100).toFixed(1)}%\n\n` +
    `Most Likely Score: ${bestScore}\n\n` +
    `O/U 2.5:\n` +
    `Over 2.5: ${(pOver25 * 100).toFixed(1)}%\n` +
    `Under 2.5: ${(pUnder25 * 100).toFixed(1)}%\n\n` +
    `BTTS (Yes): ${(pBTTS * 100).toFixed(1)}%\n\n` +
    `xG Model (means):\n` +
    `${home}: ${muHome.toFixed(2)}\n` +
    `${away}: ${muAway.toFixed(2)}\n\n` +
    `Top 5 scorelines:\n${top5}` +
    missLine
  );
};
