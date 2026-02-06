/* MatchQuant engine.js — v2
   - Deterministic Poisson (stable results)
   - Uses att/def + __league_factor from xg_tables.json
   - Outputs: 1X2, Most-likely score, Top scorelines, O/U 2.5, BTTS
   - Adds: EV badges (if odds entered), Confidence Grade
   - Adds: Asian Handicap probability + EV for chosen line (quarter-lines supported)
*/

(function () {
  "use strict";

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

  const toNum = (v) => {
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  const pct = (x) => (x * 100).toFixed(1) + "%";

  function evFromProbOdds(prob, odds) {
    const o = toNum(odds);
    if (!o || o <= 1.0001) return null;
    return prob * o - 1;
  }

  function evBadge(ev) {
    if (ev === null) return { badge: "—", label: "No odds", cls: "ev-na" };
    if (ev >= 0.03) return { badge: "🟢", label: `+EV ${(ev * 100).toFixed(1)}%`, cls: "ev-plus" };
    if (ev <= -0.03) return { badge: "🔴", label: `-EV ${(ev * 100).toFixed(1)}%`, cls: "ev-minus" };
    return { badge: "🟡", label: `Neutral ${(ev * 100).toFixed(1)}%`, cls: "ev-mid" };
  }

  // ---------- Poisson ----------
  function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poissonP(k, mu) {
    return Math.exp(-mu) * Math.pow(mu, k) / factorial(k);
  }

  // ---------- xG model (att/def style) ----------
  // Expected goals:
  // muHome = baseGoals * league_factor * homeAdv * attHome * defAway
  // muAway = baseGoals * league_factor *           attAway * defHome
  function buildXgIndex(xgRaw, league) {
    const root = xgRaw?.leagues || xgRaw || {};
    const lgObj = root?.[league] || null;

    const keyMap = {};
    if (lgObj && typeof lgObj === "object") {
      for (const k of Object.keys(lgObj)) {
        if (!k || k.startsWith("__")) continue;
        keyMap[norm(k)] = k;
      }
    }

    const ALIASES = {
      "man city": "manchester city",
      "man utd": "manchester united",
      "spurs": "tottenham",
      "tottenham hotspur": "tottenham",
      "wolves": "wolverhampton wanderers",
      "newcastle": "newcastle united",
      "real sociedad": "real sociedad",
      "real madrid": "real madrid",
      "atletico madrid": "atletico madrid",
      "bayern": "bayern munich",
      "leipzig": "rb leipzig",
    };

    function resolveKey(teamName) {
      const n = norm(teamName);
      if (keyMap[n]) return keyMap[n];

      const a = ALIASES[n];
      if (a && keyMap[a]) return keyMap[a];

      // last resort fuzzy contains
      const keys = Object.keys(keyMap);
      const hit = keys.find((k) => k.includes(n) || n.includes(k));
      return hit ? keyMap[hit] : null;
    }

    function readTeam(teamName) {
      const key = resolveKey(teamName);
      const obj = key ? lgObj?.[key] : null;
      return { key, obj };
    }

    const leagueFactor = toNum(lgObj?.__league_factor) ?? 1.0;

    return { lgObj, leagueFactor, resolveKey, readTeam };
  }

  // ---------- AH settlement over score-diff distribution ----------
  // Returns expected probabilities of win/push/loss/halfwin/halfloss for a bet on SIDE with handicap line.
  function ahSettlementFromDiff(distByDiff, line) {
    // line is handicap applied to TEAM (home if betting home side).
    // We evaluate result of (diff + line).
    // quarter lines split stake.
    const L = Number(line);

    function settleHalf(Lh) {
      // For each diff, determine outcome at this half-line:
      // diff + Lh > 0 => win
      // diff + Lh = 0 => push
      // diff + Lh < 0 => loss
      let w = 0, p = 0, l = 0;
      for (const [dStr, pr] of Object.entries(distByDiff)) {
        const d = Number(dStr);
        const v = d + Lh;
        if (v > 0) w += pr;
        else if (v < 0) l += pr;
        else p += pr;
      }
      return { w, p, l };
    }

    const isQuarter = Math.abs(L * 4 - Math.round(L * 4)) < 1e-9 && Math.abs(L * 2 - Math.round(L * 2)) > 1e-9;

    if (!isQuarter) {
      const r = settleHalf(L);
      return { win: r.w, push: r.p, loss: r.l, halfwin: 0, halfloss: 0 };
    }

    // split quarter line: e.g., -0.25 = half on 0 and half on -0.5
    const lo = Math.floor(L * 2) / 2;
    const hi = lo + 0.5;
    // Example: L=-0.25 => lo=-0.5 hi=0
    // Example: L=+0.25 => lo=0 hi=+0.5
    const a = settleHalf(lo);
    const b = settleHalf(hi);

    // Combine half-stakes:
    // Full win happens when both halves win
    // Full loss when both halves lose
    // Push when both push (rare at quarters, but possible)
    // Half win when one wins and the other pushes
    // Half loss when one loses and the other pushes
    // Otherwise (one wins one loses) net = push (win and loss cancel)
    const fullWin = a.w * b.w + a.w * b.p + a.p * b.w; // careful? not independent (same diff) so cannot multiply
    // We must combine per-diff deterministically (no independence assumption).
    // So redo properly per-diff:
    let win = 0, push = 0, loss = 0, halfwin = 0, halfloss = 0;

    for (const [dStr, pr] of Object.entries(distByDiff)) {
      const d = Number(dStr);
      const v1 = d + lo;
      const v2 = d + hi;

      const o1 = v1 > 0 ? "W" : v1 < 0 ? "L" : "P";
      const o2 = v2 > 0 ? "W" : v2 < 0 ? "L" : "P";

      if (o1 === "W" && o2 === "W") win += pr;
      else if (o1 === "L" && o2 === "L") loss += pr;
      else if (o1 === "P" && o2 === "P") push += pr;
      else if ((o1 === "W" && o2 === "P") || (o1 === "P" && o2 === "W")) halfwin += pr;
      else if ((o1 === "L" && o2 === "P") || (o1 === "P" && o2 === "L")) halfloss += pr;
      else {
        // one W one L => net push
        push += pr;
      }
    }

    return { win, push, loss, halfwin, halfloss };
  }

  function ahExpectedReturn(settle, odds) {
    const o = toNum(odds);
    if (!o || o <= 1.0001) return null;

    // For decimal odds:
    // full win profit = (o - 1)
    // half win profit = 0.5*(o - 1)
    // push profit = 0
    // half loss profit = -0.5
    // full loss profit = -1
    const profit =
      settle.win * (o - 1) +
      settle.halfwin * 0.5 * (o - 1) +
      settle.push * 0 +
      settle.halfloss * -0.5 +
      settle.loss * -1;

    return profit; // EV per 1 unit stake
  }

  // ---------- Confidence grade ----------
  function confidenceGrade(pW, pD, pL, missingXgCount) {
    const maxSide = Math.max(pW, pL);
    let grade = "C";
    if (maxSide >= 0.58 && pD <= 0.26) grade = "A";
    else if (maxSide >= 0.52 && pD <= 0.30) grade = "B";
    else grade = "C";

    if (missingXgCount >= 1) {
      // downgrade one step if missing xG for either team
      if (grade === "A") grade = "B";
      else if (grade === "B") grade = "C";
    }
    return grade;
  }

  // ---------- MAIN ----------
  window.runPrediction = function (p) {
    const {
      league, home, away,
      homeAdv, baseGoals, capGoals,
      xgRaw,
      odds // optional
    } = p;

    const cap = clampInt(capGoals ?? 8, 0, 12);
    const base = Number(baseGoals ?? 1.35);
    const ha = Number(homeAdv ?? 1.10);

    const idx = buildXgIndex(xgRaw, league);
    const homeT = idx.readTeam(home);
    const awayT = idx.readTeam(away);

    const miss = [];
    if (!homeT.key) miss.push(home);
    if (!awayT.key) miss.push(away);

    // att/def model (your xg_tables.json format)
    const attH = toNum(homeT.obj?.att) ?? 1.0;
    const defH = toNum(homeT.obj?.def) ?? 1.0;
    const attA = toNum(awayT.obj?.att) ?? 1.0;
    const defA = toNum(awayT.obj?.def) ?? 1.0;

    const leagueFactor = idx.leagueFactor ?? 1.0;

    const muHome = base * leagueFactor * ha * attH * defA;
    const muAway = base * leagueFactor * attA * defH;

    // Poisson marginals up to cap
    const ph = [], pa = [];
    for (let i = 0; i <= cap; i++) {
      ph[i] = poissonP(i, muHome);
      pa[i] = poissonP(i, muAway);
    }

    let pW = 0, pD = 0, pL = 0;
    let pOver25 = 0, pUnder25 = 0;
    let pBTTS = 0;

    const scorelines = []; // [ "2-1", prob ]
    const diffDist = {};   // diff -> prob

    let bestScore = "0-0", bestProb = -1;

    for (let hg = 0; hg <= cap; hg++) {
      for (let ag = 0; ag <= cap; ag++) {
        const pr = ph[hg] * pa[ag];
        const s = `${hg}-${ag}`;
        scorelines.push([s, pr]);

        if (pr > bestProb) { bestProb = pr; bestScore = s; }

        if (hg > ag) pW += pr;
        else if (hg < ag) pL += pr;
        else pD += pr;

        if (hg + ag >= 3) pOver25 += pr;
        else pUnder25 += pr;

        if (hg >= 1 && ag >= 1) pBTTS += pr;

        const diff = hg - ag;
        diffDist[diff] = (diffDist[diff] || 0) + pr;
      }
    }

    scorelines.sort((a, b) => b[1] - a[1]);
    const top5 = scorelines.slice(0, 5).map(([s, pr]) => ({ s, pr }));

    // Confidence
    const grade = confidenceGrade(pW, pD, pL, miss.length);

    // EV badges for main markets (if odds provided)
    const o = odds || {};
    const ev1 = evFromProbOdds(pW, o.homeML);
    const evX = evFromProbOdds(pD, o.draw);
    const ev2 = evFromProbOdds(pL, o.awayML);
    const evO25 = evFromProbOdds(pOver25, o.over25);
    const evU25 = evFromProbOdds(pUnder25, o.under25);
    const evBttsY = evFromProbOdds(pBTTS, o.bttsYes);
    const evBttsN = evFromProbOdds(1 - pBTTS, o.bttsNo);

    // Asian Handicap chosen by UI (optional)
    const ahLine = (o.ahLine !== undefined && o.ahLine !== null) ? Number(o.ahLine) : null; // home handicap line
    const ahSide = (o.ahSide === "away") ? "away" : "home";
    const ahOdds = toNum(o.ahOdds);

    let ah = null;
    if (ahLine !== null && isFinite(ahLine)) {
      // If betting away side, convert to equivalent home bet by flipping diff sign and line sign.
      // away +0.25 == home -0.25 in terms of diff (home goals - away goals).
      let settle;
      if (ahSide === "home") {
        settle = ahSettlementFromDiff(diffDist, ahLine);
      } else {
        // betting away with line Laway: evaluate on (-(diff) + Laway) > 0
        // Equivalent: (diff + (-Laway)) < 0 ... easiest: flip diffDist by negating keys
        const flipped = {};
        for (const [dStr, pr] of Object.entries(diffDist)) {
          const d = Number(dStr);
          flipped[-d] = (flipped[-d] || 0) + pr;
        }
        settle = ahSettlementFromDiff(flipped, ahLine);
      }

      const ahEV = ahExpectedReturn(settle, ahOdds);
      const badge = evBadge(ahEV);

      // "Cover-ish" probability: win + 0.5*halfwin (quick signal)
      const cover = settle.win + 0.5 * settle.halfwin;
      const fail = settle.loss + 0.5 * settle.halfloss;

      ah = {
        side: ahSide,
        line: ahLine,
        odds: ahOdds,
        settle,
        cover,
        fail,
        ev: ahEV,
        badge
      };
    }

    // quick lean (deterministic) if no AH selected:
    const lean =
      pW > pL
        ? { market: "Home -0.25", side: home, strength: (pW + 0.5 * pD) }
        : { market: "Away +0.25", side: away, strength: (pL + 0.5 * pD) };

    // package result for app.js to render
    return {
      meta: {
        league,
        home,
        away,
        cap,
        baseGoals: base,
        homeAdv: ha,
        leagueFactor,
        missingTeams: miss
      },
      probs: {
        homeWin: pW,
        draw: pD,
        awayWin: pL,
        over25: pOver25,
        under25: pUnder25,
        bttsYes: pBTTS,
        bttsNo: 1 - pBTTS
      },
      score: {
        mostLikely: bestScore,
        top5
      },
      means: {
        muHome,
        muAway
      },
      confidence: {
        grade,
        note: miss.length ? "Downgraded (missing xG mapping)" : "OK"
      },
      ev: {
        homeML: { ev: ev1, badge: evBadge(ev1) },
        draw: { ev: evX, badge: evBadge(evX) },
        awayML: { ev: ev2, badge: evBadge(ev2) },
        over25: { ev: evO25, badge: evBadge(evO25) },
        under25: { ev: evU25, badge: evBadge(evU25) },
        bttsYes: { ev: evBttsY, badge: evBadge(evBttsY) },
        bttsNo: { ev: evBttsN, badge: evBadge(evBttsN) }
      },
      ah,
      lean
    };
  };
})();
