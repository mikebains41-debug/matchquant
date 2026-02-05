/* MatchQuant engine.js — OPTION B (DETERMINISTIC POISSON) + OU2.5 + BTTS + AH lean */

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
      .replace(/\s+/g, " ");

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

  // ---------- build case-insensitive xG index ----------
  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  const leagueObj = root && root[league] ? root[league] : null;

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
    const v = leagueObj?.[originalKey]?.xGF;
    if (typeof v === "number" && isFinite(v) && v > 0) return v;
    return Number(baseGoals || 1.35);
  }

  // ---------- inputs ----------
  const cap = clampInt(capGoals, 0, 12);
  const muHome = teamXG(home) * Number(homeAdv || 1.10);
  const muAway = teamXG(away);

  // ---------- score grid ----------
  const ph = [];
  const pa = [];
  for (let i = 0; i <= cap; i++) {
    ph[i] = poissonP(i, muHome);
    pa[i] = poissonP(i, muAway);
  }

  let bestScore = "0-0";
  let bestProb = -1;

  let pW = 0, pD = 0, pL = 0;              // home W/D/L
  let pOver25 = 0, pUnder25 = 0;
  let pBTTS = 0;

  // for AH evaluation (even-odds style “edge”)
  function evHome(line, hg, ag, prob) {
    // line is from HOME perspective (e.g. -0.25 means home gives 0.25)
    // Return profit at EVEN odds, per 1 unit stake.
    const d = (hg + line) - ag;

    // Quarter lines: split stake across adjacent half/whole
    const frac = Math.abs(line % 1);
    const isQuarter = Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;

    if (!isQuarter) {
      // whole/half lines
      if (d > 0) return 1 * prob;
      if (d === 0) return 0 * prob; // push
      return -1 * prob;
    }

    // quarter line splitting
    // Example: -0.25 = half on 0 and half on -0.5
    // Example: +0.25 = half on 0 and half on +0.5
    const a = line - 0.25 * Math.sign(line); // closer to zero
    const b = line + 0.25 * Math.sign(line); // farther from zero

    function profitFor(singleLine) {
      const dd = (hg + singleLine) - ag;
      if (dd > 0) return 1;
      if (dd === 0) return 0;
      return -1;
    }

    return 0.5 * profitFor(a) * prob + 0.5 * profitFor(b) * prob;
  }

  const top = [];
  const ahCandidates = [-0.5, -0.25, 0, +0.25, +0.5]; // “practical” core lines
  const evByLine = {};
  for (const L of ahCandidates) evByLine[L] = 0;

  for (let hg = 0; hg <= cap; hg++) {
    for (let ag = 0; ag <= cap; ag++) {
      const prob = ph[hg] * pa[ag];
      const score = `${hg}-${ag}`;
      top.push([score, prob]);

      if (prob > bestProb) {
        bestProb = prob;
        bestScore = score;
      }

      // W/D/L
      if (hg > ag) pW += prob;
      else if (hg < ag) pL += prob;
      else pD += prob;

      // OU 2.5
      if (hg + ag >= 3) pOver25 += prob;
      else pUnder25 += prob;

      // BTTS
      if (hg >= 1 && ag >= 1) pBTTS += prob;

      // AH EVs for home side
      for (const L of ahCandidates) {
        evByLine[L] += evHome(L, hg, ag, prob);
      }
    }
  }

  // pick AH lean: best EV line, then decide home vs away if negative
  // If best home EV is negative, we lean the AWAY at the mirrored line.
  let bestLine = ahCandidates[0];
  for (const L of ahCandidates) {
    if (evByLine[L] > evByLine[bestLine]) bestLine = L;
  }

  let ahSide = "HOME";
  let ahLine = bestLine;
  let ahEV = evByLine[bestLine];

  if (ahEV < 0) {
    // flip to away: away +x == home -x
    ahSide = "AWAY";
    ahLine = -bestLine;
    ahEV = -ahEV; // same magnitude from the other side at even odds
  }

  // top 5 scorelines
  top.sort((a, b) => b[1] - a[1]);
  const top5 = top.slice(0, 5);

  // missing xG warning
  const missing = [];
  if (!teamKeyMap[norm(home)]) missing.push(home);
  if (!teamKeyMap[norm(away)]) missing.push(away);

  const missLine = missing.length
    ? `\n\n⚠️ xG missing for: ${missing.join(", ")}\nFix: make team names match exactly in xg_tables.json`
    : "";

  // format AH line nicely
  const fmtLine = (L) => (L > 0 ? `+${L}` : `${L}`);

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
    `Asian Handicap lean (from grid):\n` +
    `${ahSide} ${fmtLine(ahLine)} (edge≈ ${(ahEV * 100).toFixed(1)}% @ even odds)\n\n` +
    `xG Model (means):\n` +
    `${home}: ${muHome.toFixed(2)}\n` +
    `${away}: ${muAway.toFixed(2)}\n\n` +
    `Top 5 scorelines:\n` +
    top5.map(([s, pr]) => `${s} (${(pr * 100).toFixed(1)}%)`).join("\n") +
    missLine
  );
};
