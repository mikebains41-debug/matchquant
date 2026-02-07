// ah.js — Asian Handicap (fair odds) from scoreline probabilities
// Usage:
// const ah = window.MQ_AH.computeAsianHandicapFair(scoreGrid, goalCap);

(() => {
  function computeAsianHandicapFair(scoreProb, maxGoals = 10) {
    const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

    const offset = maxGoals;
    const diffProb = Array(2 * maxGoals + 1).fill(0);

    for (let h = 0; h <= maxGoals; h++) {
      const row = scoreProb[h] || {};
      for (let a = 0; a <= maxGoals; a++) {
        const p = Number(row[a] ?? 0);
        if (!p) continue;
        const d = h - a;
        if (d < -maxGoals || d > maxGoals) continue;
        diffProb[d + offset] += p;
      }
    }

    const pref = Array(diffProb.length + 1).fill(0);
    for (let i = 0; i < diffProb.length; i++) pref[i + 1] = pref[i] + diffProb[i];

    const sumIdx = (i0, i1) => {
      i0 = clampInt(i0, 0, diffProb.length - 1);
      i1 = clampInt(i1, 0, diffProb.length - 1);
      if (i1 < i0) return 0;
      return pref[i1 + 1] - pref[i0];
    };

    const P_diff_ge = (x) => sumIdx(x + offset, maxGoals + offset);
    const P_diff_gt = (x) => P_diff_ge(x + 1);
    const P_diff_le = (x) => sumIdx(-maxGoals + offset, x + offset);
    const P_diff_lt = (x) => P_diff_le(x - 1);
    const P_diff_eq = (x) => diffProb[x + offset] ?? 0;

    function evalHalfOrInt(line) {
      let win = 0, push = 0, lose = 0;

      const isInteger = Math.abs(line - Math.round(line)) < 1e-12;
      const isHalf = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12 && !isInteger;

      if (!isInteger && !isHalf) throw new Error("Line must be integer or half.");

      if (isInteger) {
        const t = -Math.round(line);
        win = P_diff_gt(t);
        push = P_diff_eq(t);
        lose = P_diff_lt(t);
        return { win, push, lose };
      }

      const t = -line; // x.5
      const smallestWin = Math.floor(t) + 1;
      const largestLose = Math.floor(t);

      win = P_diff_ge(smallestWin);
      push = 0;
      lose = P_diff_le(largestLose);
      return { win, push, lose };
    }

    function isQuarterLine(line) {
      const q = Math.round(line * 4);
      const isQuarterStep = Math.abs(line * 4 - q) < 1e-12;
      const isHalfStep = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12;
      return isQuarterStep && !isHalfStep;
    }

    function homeAhWPL(line) {
      if (!isQuarterLine(line)) return evalHalfOrInt(line);

      const lower = Math.floor(line * 2) / 2;
      const upper = lower + 0.5;

      const a = evalHalfOrInt(lower);
      const b = evalHalfOrInt(upper);

      return {
        win: 0.5 * (a.win + b.win),
        push: 0.5 * (a.push + b.push),
        lose: 0.5 * (a.lose + b.lose),
      };
    }

    function toFair(wpl) {
      const win = wpl.win, push = wpl.push, lose = wpl.lose;
      const denom = win + lose;
      const dnbWinProb = denom > 0 ? win / denom : 0;
      const fairOdds = dnbWinProb > 0 ? 1 / dnbWinProb : null;

      return {
        win,
        push,
        lose,
        dnbWinProb,
        fairOdds: fairOdds == null ? null : +fairOdds.toFixed(2),
      };
    }

    const lines = [
      -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25,
       0,  0.25,  0.5,  0.75,  1,  1.25,  1.5,  1.75, 2
    ];

    return lines.map((line) => {
      const f = toFair(homeAhWPL(line));
      return {
        line,
        home_win: +f.win.toFixed(6),
        home_push: +f.push.toFixed(6),
        home_lose: +f.lose.toFixed(6),
        home_dnbWinProb: +f.dnbWinProb.toFixed(6),
        home_fair: f.fairOdds,
      };
    });
  }

  window.MQ_AH = window.MQ_AH || {};
  window.MQ_AH.computeAsianHandicapFair = computeAsianHandicapFair;

  console.log("✅ ah.js loaded");
})();
