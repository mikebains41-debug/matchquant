/* MatchQuant engine.js — FINAL STABLE VERSION
   Deterministic Poisson + OU + BTTS + AH
*/

window.runPrediction = function (p) {
  try {
    const {
      league,
      home,
      away,
      homeAdv,
      baseGoals,
      capGoals,
      xgRaw,
      ahSide,
      ahLine
    } = p;

    // ---------- helpers ----------
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    const norm = s =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    function factorial(n) {
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }

    function poisson(k, mu) {
      return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
    }

    // ---------- get league ----------
    const leagueObj = xgRaw?.[league];
    if (!leagueObj) throw new Error("League not found in xg_tables.json");

    const leagueFactor = leagueObj.__league_factor || 1.0;

    // ---------- resolve team ----------
    function getTeam(team) {
      const n = norm(team);
      for (const key of Object.keys(leagueObj)) {
        if (key.startsWith("__")) continue;
        if (norm(key) === n) return leagueObj[key];
      }
      return null;
    }

    const homeT = getTeam(home);
    const awayT = getTeam(away);

    if (!homeT || !awayT)
      throw new Error("Team name mismatch in xg_tables.json");

    // ---------- expected goals ----------
    const muHome =
      baseGoals *
      leagueFactor *
      homeT.att *
      awayT.def *
      homeAdv;

    const muAway =
      baseGoals *
      leagueFactor *
      awayT.att *
      homeT.def;

    const cap = clamp(parseInt(capGoals || 8), 6, 12);

    // ---------- probability grid ----------
    let bestScore = "0-0";
    let bestProb = -1;

    let pW = 0,
      pD = 0,
      pL = 0,
      pOver25 = 0,
      pUnder25 = 0,
      pBTTS = 0;

    const topScores = [];

    for (let hg = 0; hg <= cap; hg++) {
      for (let ag = 0; ag <= cap; ag++) {
        const prob = poisson(hg, muHome) * poisson(ag, muAway);
        const score = `${hg}-${ag}`;

        topScores.push([score, prob]);

        if (prob > bestProb) {
          bestProb = prob;
          bestScore = score;
        }

        if (hg > ag) pW += prob;
        else if (hg < ag) pL += prob;
        else pD += prob;

        if (hg + ag >= 3) pOver25 += prob;
        else pUnder25 += prob;

        if (hg >= 1 && ag >= 1) pBTTS += prob;
      }
    }

    topScores.sort((a, b) => b[1] - a[1]);
    const top5 = topScores
      .slice(0, 5)
      .map(([s, p]) => `${s} (${(p * 100).toFixed(1)}%)`)
      .join("\n");

    // ---------- Asian Handicap lean ----------
    let ahLean = "N/A";
    if (ahSide && ahLine !== undefined) {
      const line = parseFloat(ahLine);
      if (ahSide === "Home") {
        ahLean = pW + pD * 0.5 > 0.5 ? `Home ${line}` : "No edge";
      } else {
        ahLean = pL + pD * 0.5 > 0.5 ? `Away ${line}` : "No edge";
      }
    }

    // ---------- output ----------
    alert(
      `MatchQuant says\n\n` +
        `${home} vs ${away}\n\n` +
        `Win Probabilities:\n` +
        `${home}: ${(pW * 100).toFixed(1)}%\n` +
        `Draw: ${(pD * 100).toFixed(1)}%\n` +
        `${away}: ${(pL * 100).toFixed(1)}%\n\n` +
        `Most Likely Score: ${bestScore}\n\n` +
        `O/U 2.5:\n` +
        `Over 2.5: ${(pOver25 * 100).toFixed(1)}%\n` +
        `Under 2.5: ${(pUnder25 * 100).toFixed(1)}%\n\n` +
        `BTTS Yes: ${(pBTTS * 100).toFixed(1)}%\n\n` +
        `Asian Handicap Lean:\n${ahLean}\n\n` +
        `xG means:\n` +
        `${home}: ${muHome.toFixed(2)}\n` +
        `${away}: ${muAway.toFixed(2)}\n\n` +
        `Top 5 Scorelines:\n${top5}`
    );
  } catch (err) {
    alert(`MatchQuant error:\n${err.message}`);
  }
};
