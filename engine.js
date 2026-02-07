// engine.js — MINIMAL SAFE ENGINE (DEBUG VERSION)

(() => {
  console.log("✅ MatchQuant engine loaded");

  window.MQ = window.MQ || {};

  window.MQ.predictMatchInternal = function (payload) {
    const xgHome = Number(payload.xgHome || 1.35);
    const xgAway = Number(payload.xgAway || 1.20);

    // simple poisson-ish probabilities
    const homeWin = 0.45;
    const draw = 0.25;
    const awayWin = 0.30;

    return {
      lamH: xgHome,
      lamA: xgAway,

      mostLikely: { h: 2, a: 1, p: 0.18 },

      x12: {
        home: homeWin,
        draw,
        away: awayWin,
      },

      ou25: {
        over: 0.56,
        under: 0.44,
      },

      btts: {
        yes: 0.58,
        no: 0.42,
      },

      cards: {
        lambdaTotal: (payload.cardsHome + payload.cardsAway) || 4.6,
        mostLikelyTotal: { k: 5 },
        ou45: { over: 0.52, under: 0.48 },
      },

      corners: {
        lambdaTotal: (payload.cornersHome + payload.cornersAway) || 9.8,
        mostLikelyTotal: { k: 10 },
        ou95: { over: 0.54, under: 0.46 },
      },
    };
  };
})();
