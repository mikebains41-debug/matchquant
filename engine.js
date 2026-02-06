/* MatchQuant engine.js — FULL REPLACEMENT
   - deterministic Poisson grid (no alert popups)
   - uses xg_tables.json format: league -> { __league_factor, Team -> {att, def} }
   - robust team-name matching
   - outputs: 1X2, top scorelines, O/U2.5, BTTS, AH cover prob, optional EV vs odds
*/

window.runPrediction = function (p) {
  const {
    league, home, away,
    homeAdv, baseGoals, capGoals,
    xgRaw,
    odds,  // {homeML, drawML, awayML, over25, under25, bttsYes, bttsNo}
    ah     // {side, line, odds}
  } = p || {};

  // ---------- helpers ----------
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

  const safeNum = (v, fallback = null) => {
    const n = Number(v);
    return isFinite(n) ? n : fallback;
  };

  // stable Poisson PMF without factorial overflow
  // p0 = e^-mu; p(k) = p(k-1) * mu / k
  function poissonSeries(mu, cap) {
    const out = new Array(cap + 1).fill(0);
    const m = Math.max(0, mu);
    out[0] = Math.exp(-m);
    for (let k = 1; k <= cap; k++) {
      out[k] = out[k - 1] * m / k;
    }
    // slight renorm (cap truncation)
    const s = out.reduce((a, b) => a + b, 0);
    if (s > 0) for (let k = 0; k <= cap; k++) out[k] /= s;
    return out;
  }

  function impliedProb(decOdds) {
    const o = safeNum(decOdds);
    if (!o || o <= 1) return null;
    return 1 / o;
  }

  function evFromOdds(modelProb, decOdds) {
    const o = safeNum(decOdds);
    if (!o || o <= 1) return null;
    // EV per 1 unit stake
    return modelProb * o - 1;
  }

  // ---------- read xg_tables.json ----------
  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  if (!root || !root[league]) {
    throw new Error(`League not found in xg_tables.json: ${league}`);
  }
  const leagueObj = root[league];

  const leagueFactor = (typeof leagueObj.__league_factor === "number" && isFinite(leagueObj.__league_factor))
    ? leagueObj.__league_factor
    : 1.0;

  // map normalized team -> exact key
  const teamKeyMap = {};
  Object.keys(leagueObj).forEach((k) => {
    if (!k || k.startsWith("__")) return;
    teamKeyMap[norm(k)] = k;
  });

  const ALIASES = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "tottenham hotspur": "tottenham",
    "wolves": "wolverhampton wanderers",
    "newcastle": "newcastle united",
    "brighton hove albion": "brighton",
    "inter": "internazionale",
    "ac milan": "milan",
  };

  function resolveTeamKey(team) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];

    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];

    // fuzzy contains fallback
    const keys = Object.keys(teamKeyMap);
    const hit = keys.find(k => k.includes(n) || n.includes(k));
    return hit ? teamKeyMap[hit] : null;
  }

  function teamRow(team) {
    const key = resolveTeamKey(team);
    if (!key) return null;
    const row = leagueObj[key];
    if (!row || typeof row !== "object") return null;
    return { key, row };
  }

  // ---------- build means (mu) from att/def ----------
  const base = safeNum(baseGoals, 1.35);
  const ha = safeNum(homeAdv, 1.10);

  const homeInfo = teamRow(home);
  const awayInfo = teamRow(away);

  const missing = [];
  if (!homeInfo) missing.push(home);
  if (!awayInfo) missing.push(away);

  const homeAtt = homeInfo?.row?.att;
  const homeDef = homeInfo?.row?.def;
  const awayAtt = awayInfo?.row?.att;
  const awayDef = awayInfo?.row?.def;

  // if any missing, fall back to 1.0 multipliers
  const hAtt = (typeof homeAtt === "number" && isFinite(homeAtt) && homeAtt > 0) ? homeAtt : 1.0;
  const hDef = (typeof homeDef === "number" && isFinite(homeDef) && homeDef > 0) ? homeDef : 1.0;
  const aAtt = (typeof awayAtt === "number" && isFinite(awayAtt) && awayAtt > 0) ? awayAtt : 1.0;
  const aDef = (typeof awayDef === "number" && isFinite(awayDef) && awayDef > 0) ? awayDef : 1.0;

  // classic: home mu = base * leagueFactor * homeAtt * awayDef * homeAdv
  //          away mu = base * leagueFactor * awayAtt * homeDef
  const muHome = Math.max(0.05, base * leagueFactor * hAtt * aDef * ha);
  const muAway = Math.max(0.05, base * leagueFactor * aAtt * hDef);

  // ---------- grid ----------
  const cap = clampInt(capGoals, 0, 12);
  const ph = poissonSeries(muHome, cap);
  const pa = poissonSeries(muAway, cap);

  let bestScore = "0-0";
  let bestProb = -1;

  let pW = 0, pD = 0, pL = 0;
  let pOver25 = 0, pUnder25 = 0;
  let pBTTS = 0;

  // for AH cover (optional)
  let ahOut = null;
  const ahSide = ah?.side || null;
  const ahLine = safeNum(ah?.line, null);

  function homeResultWithLine(hg, ag, line) {
    // returns: "win", "push", "lose" for HOME bet with handicap line applied
    // Example: Home -0.25:
    //   win by 1+ => win
    //   draw => half-lose
    //   lose => lose
    const diff = (hg - ag) + line;
    if (Math.abs(line % 1) === 0) {
      // integer line -> push possible
      if (diff > 0) return "win";
      if (diff === 0) return "push";
      return "lose";
    }
    // quarter lines (±0.25, ±0.75) => handle as half on adjacent half-lines
    // -0.25 = half on 0 and -0.5
    // +0.25 = half on 0 and +0.5
    // -0.75 = half on -0.5 and -1
    // +0.75 = half on +0.5 and +1
    return "quarter";
  }

  let pAhWin = 0, pAhPush = 0, pAhLose = 0, pAhHalfWin = 0, pAhHalfLose = 0;

  const top = [];

  for (let hg = 0; hg <= cap; hg++) {
    for (let ag = 0; ag <= cap; ag++) {
      const prob = ph[hg] * pa[ag];
      const score = `${hg}-${ag}`;
      top.push({ score, prob });

      if (prob > bestProb) { bestProb = prob; bestScore = score; }

      if (hg > ag) pW += prob;
      else if (hg < ag) pL += prob;
      else pD += prob;

      if (hg + ag >= 3) pOver25 += prob;
      else pUnder25 += prob;

      if (hg >= 1 && ag >= 1) pBTTS += prob;

      // AH cover probability (optional)
      if (ahSide && ahLine !== null) {
        // interpret user selection as betting that side at that line
        // Convert everything into "home bet line"
        const lineHome = (ahSide.toLowerCase() === "home") ? ahLine : -ahLine;

        const kind = homeResultWithLine(hg, ag, lineHome);
        if (kind === "win") pAhWin += prob;
        else if (kind === "push") pAhPush += prob;
        else if (kind === "lose") pAhLose += prob;
        else {
          // quarter handling by splitting into two half-lines
          let lineA, lineB;
          if (lineHome === -0.25) { lineA = 0; lineB = -0.5; }
          else if (lineHome === 0.25) { lineA = 0; lineB = 0.5; }
          else if (lineHome === -0.75) { lineA = -0.5; lineB = -1; }
          else if (lineHome === 0.75) { lineA = 0.5; lineB = 1; }
          else { lineA = Math.floor(lineHome); lineB = Math.ceil(lineHome); }

          const rA = homeResultWithLine(hg, ag, lineA);
          const rB = homeResultWithLine(hg, ag, lineB);

          // each half stake
          const half = prob * 0.5;

          // map each half
          const addHalf = (r) => {
            if (r === "win") pAhHalfWin += half;
            else if (r === "push") pAhPush += half;
            else pAhHalfLose += half;
          };
          addHalf(rA);
          addHalf(rB);
        }
      }
    }
  }

  top.sort((a, b) => b.prob - a.prob);
  const top5 = top.slice(0, 5);

  // AH output summary (cover prob ≈ win + half-win)
  if (ahSide && ahLine !== null) {
    const pCover = pAhWin + pAhHalfWin; // conservative
    const pNoCover = pAhLose + pAhHalfLose; // conservative
    ahOut = {
      side: ahSide,
      line: ahLine,
      pCover,
      pPush: pAhPush,
      pNoCover
    };
  }

  // ---------- EV badges (optional) ----------
  const ev = {};
  if (odds) {
    // 1X2
    ev.homeML = { odds: odds.homeML, ev: evFromOdds(pW, odds.homeML), modelP: pW, impP: impliedProb(odds.homeML) };
    ev.drawML = { odds: odds.drawML, ev: evFromOdds(pD, odds.drawML), modelP: pD, impP: impliedProb(odds.drawML) };
    ev.awayML = { odds: odds.awayML, ev: evFromOdds(pL, odds.awayML), modelP: pL, impP: impliedProb(odds.awayML) };

    // totals
    ev.over25 = { odds: odds.over25, ev: evFromOdds(pOver25, odds.over25), modelP: pOver25, impP: impliedProb(odds.over25) };
    ev.under25 = { odds: odds.under25, ev: evFromOdds(pUnder25, odds.under25), modelP: pUnder25, impP: impliedProb(odds.under25) };

    // btts
    const pNo = 1 - pBTTS;
    ev.bttsYes = { odds: odds.bttsYes, ev: evFromOdds(pBTTS, odds.bttsYes), modelP: pBTTS, impP: impliedProb(odds.bttsYes) };
    ev.bttsNo = { odds: odds.bttsNo, ev: evFromOdds(pNo, odds.bttsNo), modelP: pNo, impP: impliedProb(odds.bttsNo) };
  }

  let ahEV = null;
  if (ahOut && ah?.odds) {
    // approximate: treat push as 0 EV, cover prob as win
    ahEV = {
      odds: ah.odds,
      ev: evFromOdds(ahOut.pCover, ah.odds),
      modelP: ahOut.pCover,
      impP: impliedProb(ah.odds)
    };
  }

  return {
    league, home, away,
    leagueFactor,
    muHome, muAway,
    cap,
    bestScore,
    pW, pD, pL,
    pOver25, pUnder25,
    pBTTS,
    top5,
    missing,
    ahOut,
    ev,
    ahEV
  };
};
