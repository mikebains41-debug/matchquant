/* MatchQuant Engine
   - Poisson core
   - Optional xG adjustment (if xG data file exists)
   - Optional odds EV check
*/

const MQ = (() => {

  function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  function poissonPmf(k, lambda){
    // P(X=k) = e^-λ * λ^k / k!
    if (lambda <= 0) return (k === 0) ? 1 : 0;
    let p = Math.exp(-lambda);
    for(let i=1;i<=k;i++){
      p *= (lambda / i);
    }
    return p;
  }

  function buildScoreMatrix(lambdaHome, lambdaAway, cap){
    const H = [];
    for(let i=0;i<=cap;i++){
      H[i] = poissonPmf(i, lambdaHome);
    }
    const A = [];
    for(let j=0;j<=cap;j++){
      A[j] = poissonPmf(j, lambdaAway);
    }
    // matrix prob[i][j] = P(home=i, away=j)
    const M = [];
    for(let i=0;i<=cap;i++){
      M[i] = [];
      for(let j=0;j<=cap;j++){
        M[i][j] = H[i] * A[j];
      }
    }
    return M;
  }

  function summarize(M){
    let pHome=0, pDraw=0, pAway=0;
    let pO25=0, pU25=0, pBTTS=0;
    let best = {i:0,j:0,p:0};
    let cap = M.length-1;

    for(let i=0;i<=cap;i++){
      for(let j=0;j<=cap;j++){
        const p = M[i][j];
        if (p > best.p) best = {i,j,p};
        if (i>j) pHome += p;
        else if (i===j) pDraw += p;
        else pAway += p;

        const total = i+j;
        if (total >= 3) pO25 += p;
        else pU25 += p;

        if (i>=1 && j>=1) pBTTS += p;
      }
    }
    return {pHome, pDraw, pAway, best, pO25, pU25, pBTTS};
  }

  function topScorelines(M, n=5){
    const cap = M.length-1;
    const arr = [];
    for(let i=0;i<=cap;i++){
      for(let j=0;j<=cap;j++){
        arr.push({i,j,p:M[i][j]});
      }
    }
    arr.sort((a,b)=>b.p-a.p);
    return arr.slice(0,n);
  }

  function impliedProbFromDecimalOdds(odds){
    if (!odds || odds <= 1) return 0;
    return 1 / odds;
  }

  function evBadge(modelProb, odds){
    if (!odds || odds <= 1) return 0;
    const imp = impliedProbFromDecimalOdds(odds);
    // simple edge metric: model - implied
    return modelProb - imp;
  }

  function adjustLambdaWithXG(lambda, teamXG, leagueAvgXG){
    if (!teamXG || !leagueAvgXG) return lambda;
    return lambda * (teamXG / leagueAvgXG);
  }

  function calcAsianHandicapCover(M, side, line){
    // returns {cover, push}
    // side: "home" or "away"
    // line: number (0, -0.25, etc)
    if (line === "" || line === null || line === undefined) return null;
    const L = Number(line);
    if (!Number.isFinite(L)) return null;

    const cap = M.length-1;
    let cover = 0, push = 0;

    for(let i=0;i<=cap;i++){
      for(let j=0;j<=cap;j++){
        const p = M[i][j];
        const home = i;
        const away = j;

        // handicap applied to chosen side
        let a = (side === "home") ? (home + L) : (away + L);
        let b = (side === "home") ? away : home;

        if (a > b) cover += p;
        else if (Math.abs(a - b) < 1e-9) push += p;
      }
    }
    return {cover, push};
  }

  function predict(input){
    const {
      league,
      home,
      away,
      baseGoals = 1.35,
      homeAdv = 1.10,
      goalCap = 8,
      leagueFactor = 1.0,
      xgPack = null, // {homeXG, awayXG, leagueAvgXG}
      odds = {},
      ah = null // {side, line, odds}
    } = input;

    // Base lambdas (simple)
    let lambdaHome = baseGoals * homeAdv * leagueFactor;
    let lambdaAway = baseGoals * 1.00 * leagueFactor;

    // Optional xG adjustment
    if (xgPack && xgPack.leagueAvgXG){
      lambdaHome = adjustLambdaWithXG(lambdaHome, xgPack.homeXG, xgPack.leagueAvgXG);
      lambdaAway = adjustLambdaWithXG(lambdaAway, xgPack.awayXG, xgPack.leagueAvgXG);
    }

    lambdaHome = clamp(lambdaHome, 0.15, 4.5);
    lambdaAway = clamp(lambdaAway, 0.15, 4.5);

    const cap = clamp(Number(goalCap || 8), 5, 12);
    const M = buildScoreMatrix(lambdaHome, lambdaAway, cap);

    const s = summarize(M);
    const t5 = topScorelines(M, 5);

    // odds EV check (only if user entered odds)
    const ev = {
      homeML: evBadge(s.pHome, odds.homeML),
      draw: evBadge(s.pDraw, odds.draw),
      awayML: evBadge(s.pAway, odds.awayML),
      over25: evBadge(s.pO25, odds.over25),
      under25: evBadge(s.pU25, odds.under25),
      bttsYes: evBadge(s.pBTTS, odds.bttsYes),
      bttsNo: evBadge(1 - s.pBTTS, odds.bttsNo),
    };

    const ahRes = (ah && ah.line !== "" && ah.line != null)
      ? calcAsianHandicapCover(M, ah.side, ah.line)
      : null;

    return {
      league, home, away,
      means: { home: lambdaHome, away: lambdaAway, cap },
      probs: {
        home: s.pHome, draw: s.pDraw, away: s.pAway,
        over25: s.pO25, under25: s.pU25,
        bttsYes: s.pBTTS
      },
      bestScore: { home: s.best.i, away: s.best.j, p: s.best.p },
      top5: t5,
      ev,
      ah: ahRes
    };
  }

  return { predict };
})();
