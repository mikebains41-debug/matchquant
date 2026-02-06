/* MatchQuant engine.js — FULL REPLACEMENT (no AH unless selected, no EV unless odds exist) */

window.runPrediction = function (p) {
  const {
    league, home, away,
    homeAdv, baseGoals, capGoals,
    xgRaw,
    odds,
    ah
  } = p || {};

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

  function poissonSeries(mu, cap) {
    const out = new Array(cap + 1).fill(0);
    const m = Math.max(0, mu);
    out[0] = Math.exp(-m);
    for (let k = 1; k <= cap; k++) out[k] = out[k - 1] * m / k;
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
    return modelProb * o - 1;
  }

  const root = (xgRaw && xgRaw.leagues) ? xgRaw.leagues : xgRaw;
  if (!root || !root[league]) throw new Error(`League not found in xg_tables.json: ${league}`);
  const leagueObj = root[league];

  const leagueFactor = (typeof leagueObj.__league_factor === "number" && isFinite(leagueObj.__league_factor))
    ? leagueObj.__league_factor
    : 1.0;

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
    "newcastle": "newcastle united"
  };

  function resolveTeamKey(team) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];
    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];
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

  const base = safeNum(baseGoals, 1.35);
  const ha = safeNum(homeAdv, 1.10);

  const homeInfo = teamRow(home);
  const awayInfo = teamRow(away);

  const missing = [];
  if (!homeInfo) missing.push(home);
  if (!awayInfo) missing.push(away);

  const hAtt = (typeof homeInfo?.row?.att === "number" && homeInfo.row.att > 0) ? homeInfo.row.att : 1.0;
  const hDef = (typeof homeInfo?.row?.def === "number" && homeInfo.row.def > 0) ? homeInfo.row.def : 1.0;
  const aAtt = (typeof awayInfo?.row?.att === "number" && awayInfo.row.att > 0) ? awayInfo.row.att : 1.0;
  const aDef = (typeof awayInfo?.row?.def === "number" && awayInfo.row.def > 0) ? awayInfo.row.def : 1.0;

  const muHome = Math.max(0.05, base * leagueFactor * hAtt * aDef * ha);
  const muAway = Math.max(0.05, base * leagueFactor * aAtt * hDef);

  const cap = clampInt(capGoals, 0, 12);
  const ph = poissonSeries(muHome, cap);
  const pa = poissonSeries(muAway, cap);

  let bestScore = "0-0";
  let bestProb = -1;

  let pW = 0, pD = 0, pL = 0;
  let pOver25 = 0, pUnder25 = 0;
  let pBTTS = 0;

  const top = [];

  // AH only if provided (app will pass null when none)
  const doAH = !!(ah && typeof ah.line === "number" && isFinite(ah.line));
  let ahOut = null;
  let pAhWin = 0, pAhPush = 0, pAhLose = 0, pAhHalfWin = 0, pAhHalfLose = 0;

  function homeResultInt(hg, ag, line) {
    const diff = (hg - ag) + line;
    if (diff > 0) return "win";
    if (diff === 0) return "push";
    return "lose";
  }

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

      if (doAH) {
        const side = (ah.side || "Home").toLowerCase();
        const lineHome = (side === "home") ? ah.line : -ah.line;

        // handle quarter lines by splitting stake
        if (Math.abs(lineHome % 1) === 0.25 || Math.abs(lineHome % 1) === 0.75) {
          let a, b;
          if (lineHome === -0.25) { a = 0; b = -0.5; }
          else if (lineHome === 0.25) { a = 0; b = 0.5; }
          else if (lineHome === -0.75) { a = -0.5; b = -1; }
          else if (lineHome === 0.75) { a = 0.5; b = 1; }
          else { a = Math.floor(lineHome); b = Math.ceil(lineHome); }

          const rA = homeResultInt(hg, ag, a);
          const rB = homeResultInt(hg, ag, b);
          const half = prob * 0.5;

          const add = (r) => {
            if (r === "win") pAhHalfWin += half;
            else if (r === "push") pAhPush += half;
            else pAhHalfLose += half;
          };
          add(rA); add(rB);
        } else {
          const r = homeResultInt(hg, ag, lineHome);
          if (r === "win") pAhWin += prob;
          else if (r === "push") pAhPush += prob;
          else pAhLose += prob;
        }
      }
    }
  }

  top.sort((a, b) => b.prob - a.prob);
  const top5 = top.slice(0, 5);

  if (doAH) {
    const pCover = pAhWin + pAhHalfWin;
    ahOut = { side: ah.side || "Home", line: ah.line, pCover, pPush: pAhPush };
  }

  const ev = {};
  if (odds) {
    ev.homeML = { odds: odds.homeML, ev: evFromOdds(pW, odds.homeML), modelP: pW, impP: impliedProb(odds.homeML) };
    ev.drawML = { odds: odds.drawML, ev: evFromOdds(pD, odds.drawML), modelP: pD, impP: impliedProb(odds.drawML) };
    ev.awayML = { odds: odds.awayML, ev: evFromOdds(pL, odds.awayML), modelP: pL, impP: impliedProb(odds.awayML) };
    ev.over25 = { odds: odds.over25, ev: evFromOdds(pOver25, odds.over25), modelP: pOver25, impP: impliedProb(odds.over25) };
    ev.under25 = { odds: odds.under25, ev: evFromOdds(pUnder25, odds.under25), modelP: pUnder25, impP: impliedProb(odds.under25) };
    ev.bttsYes = { odds: odds.bttsYes, ev: evFromOdds(pBTTS, odds.bttsYes), modelP: pBTTS, impP: impliedProb(odds.bttsYes) };
    ev.bttsNo = { odds: odds.bttsNo, ev: evFromOdds(1 - pBTTS, odds.bttsNo), modelP: 1 - pBTTS, impP: impliedProb(odds.bttsNo) };
  }

  let ahEV = null;
  if (ahOut && ah?.odds) {
    ahEV = { odds: ah.odds, ev: evFromOdds(ahOut.pCover, ah.odds), modelP: ahOut.pCover, impP: impliedProb(ah.odds) };
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
