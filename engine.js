window.MQ2 = (function(){

  function safe(n, d=0){
    return (typeof n === "number" && !isNaN(n)) ? n : d;
  }

  function poisson(lambda, k){
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  }

  function factorial(n){
    if(n<=1) return 1;
    return n * factorial(n-1);
  }

  function randomPoisson(lambda){
    let L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do{
      k++;
      p *= Math.random();
    } while(p > L);
    return k-1;
  }

  function getTeamRow(xgTables, league, team){
    return xgTables?.[league]?.find(t => t.team === team);
  }

  function getSplitRow(splits, type, team){
    return splits?.[type]?.[team] || null;
  }

  function computeLambda({league, homeTeam, awayTeam, tables}){

    const seasonHome = getTeamRow(tables.xg, league, homeTeam);
    const seasonAway = getTeamRow(tables.xg, league, awayTeam);

    if(!seasonHome || !seasonAway){
      return {lamH:1.3, lamA:1.1};
    }

    const splits = tables.splits?.[league] || null;

    const homeSplit = splits ? getSplitRow(splits,"home",homeTeam) : null;
    const awaySplit = splits ? getSplitRow(splits,"away",awayTeam) : null;

    const home_xG = homeSplit
      ? safe(homeSplit.xG / homeSplit.matches)
      : safe(seasonHome.xG / seasonHome.matches);

    const home_xGA = homeSplit
      ? safe(homeSplit.xGA / homeSplit.matches)
      : safe(seasonHome.xGA / seasonHome.matches);

    const away_xG = awaySplit
      ? safe(awaySplit.xG / awaySplit.matches)
      : safe(seasonAway.xG / seasonAway.matches);

    const away_xGA = awaySplit
      ? safe(awaySplit.xGA / awaySplit.matches)
      : safe(seasonAway.xGA / seasonAway.matches);

    return {
      lamH:(home_xG + away_xGA)/2,
      lamA:(away_xG + home_xGA)/2
    };
  }

  function simulate(lamH, lamA, iterations=20000){

    let home=0, draw=0, away=0, total=0;

    for(let i=0;i<iterations;i++){
      const h = randomPoisson(lamH);
      const a = randomPoisson(lamA);

      total += h+a;

      if(h>a) home++;
      else if(h<a) away++;
      else draw++;
    }

    return {
      pHome:home/iterations,
      pDraw:draw/iterations,
      pAway:away/iterations,
      expTotal:total/iterations
    };
  }

  function analyzeMatch({league, homeTeam, awayTeam, tables, options}){

    const {lamH, lamA} = computeLambda({
      league,
      homeTeam,
      awayTeam,
      tables
    });

    const sim = simulate(lamH, lamA, 20000);

    return {
      inputs:{
        league,
        homeTeam,
        awayTeam,
        lamH,
        lamA,
        pace:1
      },
      model:{
        expHome:lamH,
        expAway:lamA,
        expTotal:sim.expTotal,
        pHome:sim.pHome,
        pDraw:sim.pDraw,
        pAway:sim.pAway,
        bestScore:{h:1,a:1,p:0.09}
      }
    };
  }

  return {
    analyzeMatch
  };

})();
