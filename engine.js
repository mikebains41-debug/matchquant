/*  MatchQuant engine.js (DROP-IN REPLACEMENT)
    - Exposes: window.runPrediction(params)
    - Robust to different JSON shapes for xg_tables + h2h
    - Produces: top 3 scorelines + shaped ranking (reduces 1-1 spam)
    - Adds: Pro confidence grade (A/B/C)
    - Adds: Asian Handicap recommendation (line + cover probability)
*/

(() => {
  "use strict";

  // ---------- small utils ----------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);

  function safeNum(x, d = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
  }

  function normName(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "'")
      .replace(/-/g, " ");
  }

  function keyPair(league, home, away) {
    return `${normName(league)}::${normName(home)}::${normName(away)}`;
  }

  // Poisson sampler: Knuth for small lambda, normal approx for bigger lambda
  function poisson(lambda) {
    lambda = Math.max(0, lambda);
    if (lambda <= 0) return 0;

    // For larger lambdas, Knuth can be slow; normal approximation is fine for sims
    if (lambda > 30) {
      const u1 = Math.random() || 1e-12;
      const u2 = Math.random() || 1e-12;
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const n = Math.round(lambda + Math.sqrt(lambda) * z);
      return Math.max(0, n);
    }

    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  // ---------- xG extraction ----------
  function flattenXgRows(xgRaw) {
    // Goal: return array of rows like:
    // { league, team, xgFor, xgAgainst, ... }
    const rows = [];

    if (!xgRaw) return rows;

    // Shape A: array of rows
    const rootA = xgRaw.leagues || xgRaw.data || xgRaw.rows || xgRaw;
    if (Array.isArray(rootA)) {
      for (const r of rootA) {
        const league = r.league || r.League || r.competition || r.comp;
        const team = r.team || r.Team || r.squad || r.Squad || r.name;
        if (!league || !team) continue;

        const xgFor =
          r.xg_for ?? r.xgFor ?? r.xG ?? r.xgf ?? r.xG_for ?? r.xGFor;
        const xgAgainst =
          r.xg_against ?? r.xgAgainst ?? r.xGA ?? r.xga ?? r.xG_against ?? r.xGAgainst;

        rows.push({
          league: String(league),
          team: String(team),
          xgFor: safeNum(xgFor, NaN),
          xgAgainst: safeNum(xgAgainst, NaN),
        });
      }
      return rows;
    }

    // Shape B: object map { "La Liga": { "Barcelona": {...} } }
    if (rootA && typeof rootA === "object") {
      // If it has a "leagues" object
      const obj = xgRaw.leagues && typeof xgRaw.leagues === "object" ? xgRaw.leagues : rootA;

      for (const lg of Object.keys(obj)) {
        const teamsObj = obj[lg];
        if (!teamsObj || typeof teamsObj !== "object") continue;

        // team entries may be array or object
        if (Array.isArray(teamsObj)) {
          for (const t of teamsObj) {
            const team = t.team || t.name || t.squad;
            if (!team) continue;
            rows.push({
              league: String(lg),
              team: String(team),
              xgFor: safeNum(t.xgFor ?? t.xg_for ?? t.xG ?? t.xgf, NaN),
              xgAgainst: safeNum(t.xgAgainst ?? t.xg_against ?? t.xGA ?? t.xga, NaN),
            });
          }
        } else {
          for (const tm of Object.keys(teamsObj)) {
            const v = teamsObj[tm] || {};
            rows.push({
              league: String(lg),
              team: String(tm),
              xgFor: safeNum(v.xgFor ?? v.xg_for ?? v.xG ?? v.xgf, NaN),
              xgAgainst: safeNum(v.xgAgainst ?? v.xg_against ?? v.xGA ?? v.xga, NaN),
            });
          }
        }
      }
    }

    return rows;
  }

  function buildXgIndex(xgRaw) {
    const rows = flattenXgRows(xgRaw);

    const byLeagueTeam = new Map(); // key: league::team -> {xgFor,xgAgainst}
    const leagueAgg = new Map(); // league -> {sumFor, sumAgainst, n, avgFor, avgAgainst}

    for (const r of rows) {
      const league = String(r.league);
      const team = String(r.team);
      const xgFor = r.xgFor;
      const xgAgainst = r.xgAgainst;

      // If missing numbers, skip row
      if (!isNum(xgFor) || !isNum(xgAgainst)) continue;

      byLeagueTeam.set(keyPair(league, team, ""), { xgFor, xgAgainst });

      const agg = leagueAgg.get(league) || { sumFor: 0, sumAgainst: 0, n: 0 };
      agg.sumFor += xgFor;
      agg.sumAgainst += xgAgainst;
      agg.n += 1;
      leagueAgg.set(league, agg);
    }

    for (const [lg, agg] of leagueAgg.entries()) {
      agg.avgFor = agg.n ? agg.sumFor / agg.n : 1.35;
      agg.avgAgainst = agg.n ? agg.sumAgainst / agg.n : 1.35;
      leagueAgg.set(lg, agg);
    }

    return { byLeagueTeam, leagueAgg };
  }

  function getTeamXg(index, league, team) {
    if (!index || !league || !team) return null;
    const k = keyPair(league, team, ""); // away part blank in this key
    // try exact norm match by scanning keys if needed
    if (index.byLeagueTeam.has(k)) return index.byLeagueTeam.get(k);

    // fallback scan within league
    const nTeam = normName(team);
    const nLeague = normName(league);

    for (const [kk, vv] of index.byLeagueTeam.entries()) {
      const [lg, tm] = kk.split("::");
      if (lg === nLeague && tm === nTeam) return vv;
    }
    return null;
  }

  // ---------- H2H extraction (optional) ----------
  function findLastH2H(h2hRaw, league, home, away) {
    // Goal: return { score:"2-1", corners: 10, cards: 5 } if available
    if (!h2hRaw) return null;

    const nLeague = normName(league);
    const a = normName(home);
    const b = normName(away);

    const candidates = [];

    const root = h2hRaw.matches || h2hRaw.h2h || h2hRaw.data || h2hRaw;
    if (Array.isArray(root)) {
      for (const r of root) {
        const lg = normName(r.league || r.League || r.competition || "");
        const h = normName(r.home || r.homeTeam || r.h || "");
        const aw = normName(r.away || r.awayTeam || r.a || "");
        if (!h || !aw) continue;
        if (lg && lg !== nLeague) continue;

        const ok =
          (h === a && aw === b) ||
          (h === b && aw === a);

        if (!ok) continue;

        const date = r.date || r.kickoff || r.time || r.timestamp || "";
        const hs = safeNum(r.homeGoals ?? r.hg ?? r.home_score ?? r.homeScore, NaN);
        const as = safeNum(r.awayGoals ?? r.ag ?? r.away_score ?? r.awayScore, NaN);
        const corners = safeNum(r.corners ?? r.totalCorners ?? r.corners_total, NaN);
        const cards = safeNum(r.cards ?? r.totalCards ?? r.cards_total, NaN);

        candidates.push({
          date,
          hs,
          as,
          corners,
          cards,
        });
      }
    } else if (root && typeof root === "object") {
      // Could be keyed object
      for (const k of Object.keys(root)) {
        const r = root[k];
        if (!r || typeof r !== "object") continue;

        const lg = normName(r.league || r.League || "");
        const h = normName(r.home || r.homeTeam || "");
        const aw = normName(r.away || r.awayTeam || "");
        if (!h || !aw) continue;
        if (lg && lg !== nLeague) continue;

        const ok =
          (h === a && aw === b) ||
          (h === b && aw === a);
        if (!ok) continue;

        const date = r.date || r.kickoff || r.time || r.timestamp || "";
        const hs = safeNum(r.homeGoals ?? r.hg ?? r.home_score ?? r.homeScore, NaN);
        const as = safeNum(r.awayGoals ?? r.ag ?? r.away_score ?? r.awayScore, NaN);
        const corners = safeNum(r.corners ?? r.totalCorners ?? r.corners_total, NaN);
        const cards = safeNum(r.cards ?? r.totalCards ?? r.cards_total, NaN);

        candidates.push({ date, hs, as, corners, cards });
      }
    }

    if (!candidates.length) return null;

    // sort by date-ish (best effort), newest last
    candidates.sort((x, y) => String(x.date).localeCompare(String(y.date)));

    const last = candidates[candidates.length - 1];
    const score =
      isNum(last.hs) && isNum(last.as) ? `${last.hs}-${last.as}` : null;

    return {
      score,
      corners: isNum(last.corners) ? last.corners : null,
      cards: isNum(last.cards) ? last.cards : null,
    };
  }

  // ---------- core model ----------
  function computeLambdas({ league, home, away, baseGoals, homeAdv, leagueFactorOverride }, xgIndex) {
    const base = clamp(safeNum(baseGoals, 1.35), 0.6, 3.0);
    const hAdv = clamp(safeNum(homeAdv, 1.10), 0.95, 1.25);
    const lfOverride = safeNum(leagueFactorOverride, NaN);

    const leagueAgg = xgIndex?.leagueAgg?.get(league) || {
      avgFor: 1.35,
      avgAgainst: 1.35,
    };

    const homeRow = getTeamXg(xgIndex, league, home);
    const awayRow = getTeamXg(xgIndex, league, away);

    // fallback if missing
    const hFor = homeRow?.xgFor ?? leagueAgg.avgFor;
    const hAg = homeRow?.xgAgainst ?? leagueAgg.avgAgainst;
    const aFor = awayRow?.xgFor ?? leagueAgg.avgFor;
    const aAg = awayRow?.xgAgainst ?? leagueAgg.avgAgainst;

    // attack/def multipliers vs league average
    const hAtt = hFor / (leagueAgg.avgFor || 1.35);
    const hDef = hAg / (leagueAgg.avgAgainst || 1.35);
    const aAtt = aFor / (leagueAgg.avgFor || 1.35);
    const aDef = aAg / (leagueAgg.avgAgainst || 1.35);

    // league factor: slightly adjusts overall goal environment
    let leagueFactor = 1.0;
    if (Number.isFinite(lfOverride) && lfOverride > 0) {
      leagueFactor = clamp(lfOverride, 0.80, 1.25);
    }

    // expected goals:
    // home: base * homeAdv * (home attack) * (away defense)
    // away: base * (away attack) * (home defense)
    let lamH = base * hAdv * hAtt * aDef * leagueFactor;
    let lamA = base * aAtt * hDef * leagueFactor;

    // clamp sanity
    lamH = clamp(lamH, 0.15, 4.5);
    lamA = clamp(lamA, 0.15, 4.5);

    return { lamH, lamA };
  }

  function simulate({ sims, capGoals }, lamH, lamA) {
    const N = clamp(Math.floor(safeNum(sims, 10000)), 1000, 200000);
    const cap = clamp(Math.floor(safeNum(capGoals, 8)), 5, 12);

    let homeW = 0,
      draw = 0,
      awayW = 0;

    let over25 = 0;

    const scoreCounts = new Map(); // "h-a" -> count

    // AH cover counts for home lines
    const lines = [-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, +0.25, +0.5, +0.75, +1, +1.25, +1.5];
    const cover = new Map(lines.map((l) => [l, 0])); // count where bet "wins" (push counts separately)
    const push = new Map(lines.map((l) => [l, 0]));

    for (let i = 0; i < N; i++) {
      let hg = poisson(lamH);
      let ag = poisson(lamA);
      if (hg > cap) hg = cap;
      if (ag > cap) ag = cap;

      if (hg > ag) homeW++;
      else if (hg === ag) draw++;
      else awayW++;

      if (hg + ag > 2.5) over25++;

      const sk = `${hg}-${ag}`;
      scoreCounts.set(sk, (scoreCounts.get(sk) || 0) + 1);

      const diff = hg - ag;

      for (const l of lines) {
        // Home handicap: home goals + handicap vs away goals
        // result = diff + l
        const r = diff + l;

        if (r > 0) cover.set(l, cover.get(l) + 1);
        else if (r === 0) push.set(l, push.get(l) + 1);
        // else loss -> nothing
      }
    }

    return {
      N,
      cap,
      homeW,
      draw,
      awayW,
      over25,
      scoreCounts,
      cover,
      push,
      lines,
    };
  }

  function shapeScoreRanking(scoreProbArr) {
    // scoreProbArr: [{score, p, hg, ag}]
    // Apply mild "pro shaping" to reduce draw spam and elevate plausible win scorelines.
    // - small penalty to draws
    // - small boost to home wins when home is slight favorite in xG
    // (we'll apply symmetric shaping here; the model already knows win probs)
    return scoreProbArr.map((s) => {
      let w = 1.0;
      if (s.hg === s.ag) w *= 0.965; // damp draws a bit
      // Penalize weird high draws slightly (3-3, 4-4)
      if (s.hg === s.ag && s.hg >= 3) w *= 0.93;
      // Slight boost to 2-1 / 1-0 / 2-0 / 3-1 type scorelines
      const scoreStr = s.score;
      if (scoreStr === "2-1" || scoreStr === "1-0" || scoreStr === "2-0" || scoreStr === "3-1") w *= 1.05;
      if (scoreStr === "1-2" || scoreStr === "0-1" || scoreStr === "0-2" || scoreStr === "1-3") w *= 1.02;
      return { ...s, shaped: s.p * w };
    });
  }

  function confidenceGrade(pHome, pDraw, pAway, lamH, lamA) {
    const favP = Math.max(pHome, pAway);
    const gap = Math.abs(pHome - pAway);
    const total = lamH + lamA;

    // Simple sharp-style grading:
    // A: strong favorite or strong separation + decent sample signal
    // B: moderate edge
    // C: coinflip-ish
    if ((favP >= 0.57 && gap >= 0.18) || (gap >= 0.22 && total >= 2.4)) return "A";
    if ((favP >= 0.52 && gap >= 0.10) || (gap >= 0.14 && total >= 2.2)) return "B";
    return "C";
  }

  function recommendAH(simRes, pHome, pAway) {
    // Recommend a HOME handicap line (negative if home is stronger, positive if home weaker)
    // We choose the line with cover probability closest to 0.54 (slight edge),
    // but we also respect favorite/underdog direction.
    const target = 0.54;

    const isHomeFav = pHome >= pAway;

    // candidate lines based on direction
    const candidates = simRes.lines.filter((l) => (isHomeFav ? l <= 0 : l >= 0));

    let best = null;

    for (const l of candidates) {
      const wins = simRes.cover.get(l) || 0;
      const pushes = simRes.push.get(l) || 0;
      const losses = simRes.N - wins - pushes;

      // "cover probability" ignoring pushes
      const denom = wins + losses;
      const coverProb = denom > 0 ? wins / denom : wins / simRes.N;

      // distance from target
      const dist = Math.abs(coverProb - target);

      // mild preference for simpler quarter lines near 0 for underdogs
      const complexityPenalty = Math.abs(l) >= 1.25 ? 0.03 : Math.abs(l) >= 0.75 ? 0.015 : 0.0;

      const score = dist + complexityPenalty;

      if (!best || score < best.score) {
        best = { line: l, coverProb, pushProb: pushes / simRes.N, score };
      }
    }

    // fallback
    if (!best) best = { line: 0, coverProb: 0.5, pushProb: 0, score: 999 };

    return best;
  }

  function pct(x) {
    return `${(x * 100).toFixed(1)}%`;
  }

  function formatLine(l) {
    // Ensure + sign
    if (l > 0) return `+${l}`;
    if (Object.is(l, -0)) return "0";
    return `${l}`;
  }

  // ---------- PUBLIC: runPrediction ----------
  window.runPrediction = function runPrediction(params) {
    try {
      if (!params) throw new Error("Missing params");

      const league = params.league;
      const home = params.home;
      const away = params.away;

      if (!league || !home || !away) {
        throw new Error("Select league + home + away");
      }

      const xgRaw = params.xgRaw;
      const h2hRaw = params.h2hRaw;

      const sims = safeNum(params.sims, 10000);
      const homeAdv = safeNum(params.homeAdv, 1.10);
      const baseGoals = safeNum(params.baseGoals, 1.35);
      const capGoals = safeNum(params.capGoals, 8);
      const leagueFactorOverride = params.leagueFactorOverride;

      const xgIndex = buildXgIndex(xgRaw);

      const { lamH, lamA } = computeLambdas(
        { league, home, away, baseGoals, homeAdv, leagueFactorOverride },
        xgIndex
      );

      const simRes = simulate({ sims, capGoals }, lamH, lamA);

      const pHome = simRes.homeW / simRes.N;
      const pDraw = simRes.draw / simRes.N;
      const pAway = simRes.awayW / simRes.N;

      const pOver25 = simRes.over25 / simRes.N;

      // scoreline probabilities
      const scoreProbArr = [];
      for (const [score, c] of simRes.scoreCounts.entries()) {
        const [hg, ag] = score.split("-").map((v) => parseInt(v, 10));
        scoreProbArr.push({ score, hg, ag, p: c / simRes.N });
      }

      // shape + renormalize for ranking ONLY
      const shaped = shapeScoreRanking(scoreProbArr);
      const shapedSum = shaped.reduce((s, r) => s + r.shaped, 0) || 1;
      const ranked = shaped
        .map((r) => ({ ...r, shapedP: r.shaped / shapedSum }))
        .sort((a, b) => b.shapedP - a.shapedP);

      const top3 = ranked.slice(0, 3);

      const grade = confidenceGrade(pHome, pDraw, pAway, lamH, lamA);

      const ah = recommendAH(simRes, pHome, pAway);

      // H2H (optional)
      const last = findLastH2H(h2hRaw, league, home, away);
      const lastScoreTxt = last?.score ? `${last.score}` : "N/A";
      const corners = isNum(last?.corners) ? last.corners : 11.0;
      const cards = isNum(last?.cards) ? last.cards : 5.0;

      // Market lean text
      let ouLean = "Lean";
      if (pOver25 >= 0.54) ouLean = "Over";
      else if (pOver25 <= 0.46) ouLean = "Under";

      // Winner lean
      let mlLean = "Draw/No strong lean";
      if (pHome > pAway && pHome >= 0.50) mlLean = home;
      if (pAway > pHome && pAway >= 0.50) mlLean = away;

      const linesText = top3
        .map((t, i) => `${i + 1}) ${t.score} (${pct(t.shapedP)})`)
        .join("\n");

      const out = {
        league,
        home,
        away,
        lamH,
        lamA,
        winProb: { home: pHome, draw: pDraw, away: pAway },
        over25Prob: pOver25,
        top3,
        grade,
        ah,
        lastH2H: last,
        cornersAvg: corners,
        cardsAvg: cards,
      };

      // Build display text (app.js can alert/Modal this)
      const text =
        `${home} vs ${away} (${league})\n\n` +
        `Last H2H: ${lastScoreTxt} | corners: ${corners.toFixed(1)} | cards: ${cards.toFixed(1)}\n\n` +
        `xG λ:\n` +
        `${home}: ${lamH.toFixed(2)}\n` +
        `${away}: ${lamA.toFixed(2)}\n\n` +
        `Win Probabilities:\n` +
        `${home}: ${pct(pHome)}\n` +
        `Draw: ${pct(pDraw)}\n` +
        `${away}: ${pct(pAway)}\n\n` +
        `Top Scores (shaped):\n${linesText}\n\n` +
        `Markets:\n` +
        `O/U 2.5 → ${ouLean} (Over prob: ${pct(pOver25)})\n` +
        `ML Lean → ${mlLean}\n` +
        `Asian Handicap (Home) → ${formatLine(ah.line)} (cover: ${pct(ah.coverProb)})\n` +
        `Confidence → ${grade}\n`;

      // Store + event for any UI to consume
      window.__matchQuantLast = { out, text, ts: Date.now() };
      try {
        window.dispatchEvent(new CustomEvent("matchquant:prediction", { detail: { out, text } }));
      } catch (_) {}

      // Return text (so app.js can display it)
      return text;
    } catch (e) {
      console.error("MatchQuant prediction error:", e);
      // Throw so app.js catch can show its error UI
      throw e;
    }
  };
})();
```0
