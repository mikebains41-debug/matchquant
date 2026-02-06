/* MatchQuant engine.js — FULL REPLACEMENT
   Deterministic Poisson using:
   - xg_tables.json league object with { att, def } per team
   - "__league_factor" metadata (ignored as a team, used in model)
   Outputs:
   - 1X2 probs
   - Most likely score
   - O/U 2.5 probs
   - BTTS
   - Asian handicap lean (simple)
*/

window.runPrediction = function (p) {
  const { league, home, away, homeAdv, baseGoals, capGoals, xgRaw } = p;

  // ---------- normalize ----------
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

  // ---------- get league object ----------
  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  const leagueObj = (root && root[league] && typeof root[league] === "object") ? root[league] : null;

  if (!leagueObj) {
    alert(`MatchQuant says\n\nLeague not found in xg_tables.json:\n${league}\n\nCheck league names match.`);
    return;
  }

  const leagueFactor = (typeof leagueObj.__league_factor === "number" && isFinite(leagueObj.__league_factor))
    ? leagueObj.__league_factor
    : 1.0;

  // map normalized team -> real key
  const teamKeyMap = {};
  for (const k of Object.keys(leagueObj)) {
    if (!k || String(k).startsWith("__")) continue;
    teamKeyMap[norm(k)] = k;
  }

  // common aliases
  const ALIASES = {
    "man city": "manchester city",
    "manchester city": "manchester city",
    "man utd": "manchester united",
    "man united": "manchester united",
    "spurs": "tottenham",
    "tottenham hotspur": "tottenham",
    "newcastle": "newcastle united",
    "west ham": "west ham",
  };

  function resolveTeamKey(team) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];

    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];

    // last resort contains match
    const keys = Object.keys(teamKeyMap);
    const hit = keys.find((k) => k.includes(n) || n.includes(k));
    return hit ? teamKeyMap[hit] : null;
  }

  function getAttDef(team) {
    const key = resolveTeamKey(team);
    if (!key) return null;
    const obj = leagueObj[key];
    const att = (obj && typeof obj.att === "number" && isFinite(obj.att)) ? obj.att : null;
    const def = (obj && typeof obj.def === "number" && isFinite(obj.def)) ? obj.def : null;
    if (!att || !def) return null;
    return { att, def, key };
  }

  const hAD = getAttDef(home);
  const aAD = getAttDef(away);

  // if missing, fall back but tell user exactly why
  const miss = [];
  if (!hAD) miss.push(home);
  if (!aAD) miss.push(away);

  // ---------- model: expected goals ----------
  // Interpreting:
  // - att > 1 boosts scoring
  // - def < 1 means strong defense (reduces opponent scoring), def > 1 weak defense (increases opponent scoring)
  // muHome = baseGoals * leagueFactor * homeAdv * attHome * defAway
  // muAway = baseGoals * leagueFactor * attAway * defHome
  const bg = Number(baseGoals || 1.35);
  const ha = Number(homeAdv || 1.10);

  const attH = hAD ? hAD.att : 1.0;
  const defH = hAD ? hAD.def : 1.0;
  const attA = aAD ? aAD.att : 1.0;
  const defA = aAD ? aAD.def : 1.0;

  const muHome = bg * leagueFactor * ha * attH * defA;
  const muAway = bg * leagueFactor * attA * defH;

  // ---------- Poisson ----------
  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  function poissonP(k, mu) {
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  const cap = clampInt(capGoals, 0, 12);

  // marginals
  const ph = [], pa = [];
  for (let i = 0; i <= cap; i++) {
    ph[i] = poissonP(i, muHome);
    pa[i] = poissonP(i, muAway);
  }

  // grid sums
  let bestScore = "0-0", bestProb = -1;
  let pW = 0, pD = 0, pL = 0;
  let pOver25 = 0, pUnder25 = 0;
  let pBTTS = 0;

  // AH leans (common lines)
  let pHomeCoverMinus05 = 0; // home -0.5 (same as win)
  let pAwayPlus05 = 0;       // away +0.5 (away win or draw)
  let pHomeCoverMinus025 = 0; // home -0.25 (win + half draw)
  let pAwayPlus025 = 0;       // away +0.25 (win + half draw)

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

      // AH approximations from grid
      if (hg > ag) pHomeCoverMinus05 += prob;           // home win
      if (hg >= ag) pAwayPlus05 += prob;               // away +0.5 cashes on draw or away win
      if (hg > ag) pHomeCoverMinus025 += prob;         // win full
      if (hg === ag) pHomeCoverMinus025 += prob * 0.5;  // draw half loss for home -0.25 (approx EV proxy)
      if (hg < ag) pAwayPlus025 += prob;               // away win full
      if (hg === ag) pAwayPlus025 += prob * 0.5;       // draw half win for away +0.25
    }
  }

  top.sort((a, b) => b[1] - a[1]);
  const top5 = top.slice(0, 5).map(([s, pr]) => `${s} (${(pr * 100).toFixed(1)}%)`).join("\n");

  // choose simple AH lean
  const ahLean =
    (pHomeCoverMinus025 > pAwayPlus025)
      ? `${home} -0.25 lean (${(pHomeCoverMinus025 * 100).toFixed(1)}%)`
      : `${away} +0.25 lean (${(pAwayPlus025 * 100).toFixed(1)}%)`;

  const missLine = miss.length
    ? `\n\n⚠️ Missing att/def for: ${miss.join(", ")}\nCheck team names in fixtures vs xg_tables.json`
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
    `Asian Handicap (quick lean):\n${ahLean}\n\n` +
    `Model inputs:\n` +
    `league_factor: ${leagueFactor.toFixed(2)}\n` +
    `mu(home): ${muHome.toFixed(2)}\n` +
    `mu(away): ${muAway.toFixed(2)}\n\n` +
    `Top 5 scorelines:\n${top5}` +
    missLine
  );
};
