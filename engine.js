/* MatchQuant engine.js — FULL REPLACEMENT (Deterministic Poisson + att/def model) */

(function () {
  // ---------- small helpers ----------
  const clampInt = (n, lo, hi) => {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  };

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ");

  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonP(k, mu) {
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  // ---------- robust league/team access ----------
  function getLeagueObj(xgRaw, league) {
    const root = xgRaw?.leagues || xgRaw;
    return root?.[league] || null;
  }

  function buildTeamKeyMap(leagueObj) {
    const map = {};
    if (!leagueObj) return map;
    for (const k of Object.keys(leagueObj)) {
      if (!k || k.startsWith("__")) continue;
      map[norm(k)] = k;
    }
    return map;
  }

  const ALIASES = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "tottenham hotspur": "tottenham",
    "wolves": "wolverhampton wanderers",
    "newcastle": "newcastle united",
  };

  function resolveTeamKey(team, teamKeyMap) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];
    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];

    // last resort fuzzy contains
    const keys = Object.keys(teamKeyMap);
    const hit = keys.find((k) => k.includes(n) || n.includes(k));
    return hit ? teamKeyMap[hit] : null;
  }

  // ---------- the engine ----------
  window.runPrediction = function (p) {
    const {
      league,
      home,
      away,
      homeAdv = 1.10,
      baseGoals = 1.35,
      capGoals = 8,
      xgRaw,
      // optional market inputs
      odds, // {homeML,drawML,awayML,over25,under25,bttsYes,bttsNo}
      ah,   // {side:"Home"|"Away", line:-0.25, odds:1.95}
    } = p;

    if (!league || !home || !away) {
      throw new Error("Missing league/home/away selection.");
    }
    if (home === away) {
      throw new Error("Home and Away teams cannot be the same.");
    }
    if (!xgRaw) {
      throw new Error("xg_tables.json not loaded (xgRaw is null).");
    }

    const cap = clampInt(capGoals, 0, 12);
    const leagueObj = getLeagueObj(xgRaw, league);
    if (!leagueObj) throw new Error(`League not found in xg_tables.json: ${league}`);

    const teamKeyMap = buildTeamKeyMap(leagueObj);

    const hKey = resolveTeamKey(home, teamKeyMap);
    const aKey = resolveTeamKey(away, teamKeyMap);

    const lf = typeof leagueObj.__league_factor === "number" ? leagueObj.__league_factor : 1.0;

    // Your xg_tables.json uses att/def (not xGF). We'll compute means like a standard attack/defense model.
    function teamAttDef(key) {
      const t = key ? leagueObj[key] : null;
      const att = typeof t?.att === "number" ? t.att : 1.0;
      const def = typeof t?.def === "number" ? t.def : 1.0;
      return { att, def };
    }

    const H = teamAttDef(hKey);
    const A = teamAttDef(aKey);

    // Expected goals:
    // muHome = baseGoals * league_factor * att_home * def_away * homeAdv
    // muAway = baseGoals * league_factor * att_away * def_home
    const muHome = Number(baseGoals) * lf * H.att * A.def * Number(homeAdv);
    const muAway = Number(baseGoals) * lf * A.att * H.def;

    // Build poisson grid
    const ph = [], pa = [];
    for (let i = 0; i <= cap; i++) {
      ph[i] = poissonP(i, muHome);
      pa[i] = poissonP(i, muAway);
    }

    let bestScore = "0-0", bestProb = -1;
    let pW = 0, pD = 0, pL = 0;
    let pOver25 = 0, pUnder25 = 0, pBTTS = 0;

    const top = [];

    for (let hg = 0; hg <= cap; hg++) {
      for (let ag = 0; ag <= cap; ag++) {
        const pr = ph[hg] * pa[ag];
        top.push([`${hg}-${ag}`, pr]);

        if (pr > bestProb) { bestProb = pr; bestScore = `${hg}-${ag}`; }

        if (hg > ag) pW += pr;
        else if (hg < ag) pL += pr;
        else pD += pr;

        if (hg + ag >= 3) pOver25 += pr;
        else pUnder25 += pr;

        if (hg >= 1 && ag >= 1) pBTTS += pr;
      }
    }

    top.sort((a, b) => b[1] - a[1]);
    const top5 = top.slice(0, 5).map(([s, pr]) => ({ score: s, prob: pr }));

    // Asian handicap quick probability
    let ahOut = null;
    if (ah && typeof ah.line === "number" && (ah.side === "Home" || ah.side === "Away")) {
      const line = ah.line;
      const side = ah.side;

      // Probability the selected side "covers" on that line (simple cover probability)
      // Home cover if (HG + line > AG)
      // Away cover if (AG + line > HG)
      let pCover = 0;
      for (let hg = 0; hg <= cap; hg++) {
        for (let ag = 0; ag <= cap; ag++) {
          const pr = ph[hg] * pa[ag];
          const cover = (side === "Home")
            ? (hg + line > ag)
            : (ag + line > hg);
          if (cover) pCover += pr;
        }
      }
      ahOut = { side, line, pCover };
    }

    // EV badge helper (optional)
    function ev(prob, decOdds) {
      const o = Number(decOdds);
      if (!isFinite(o) || o <= 1) return null;
      return prob * o - 1; // expected ROI per 1 unit stake
    }

    const evs = odds ? {
      homeML: ev(pW, odds.homeML),
      drawML: ev(pD, odds.drawML),
      awayML: ev(pL, odds.awayML),
      over25: ev(pOver25, odds.over25),
      under25: ev(pUnder25, odds.under25),
      bttsYes: ev(pBTTS, odds.bttsYes),
      bttsNo: ev(1 - pBTTS, odds.bttsNo),
    } : null;

    const missing = [];
    if (!hKey) missing.push(home);
    if (!aKey) missing.push(away);

    return {
      league,
      home,
      away,
      bestScore,
      pW, pD, pL,
      pOver25, pUnder25,
      pBTTS,
      muHome, muAway,
      top5,
      ahOut,
      evs,
      missing,
      model: {
        league_factor: lf,
        baseGoals: Number(baseGoals),
        homeAdv: Number(homeAdv),
        home: { key: hKey, att: H.att, def: H.def },
        away: { key: aKey, att: A.att, def: A.def },
      }
    };
  };
})();
