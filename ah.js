// ah.js — Asian Handicap (fair odds) from scoreline probabilities
// Usage:
// const ahRows = window.MQ_AH.computeAsianHandicapFair(scoreGrid, goalCap);

(() => {
  "use strict";

  function computeAsianHandicapFair(scoreGrid, goalCap = 10) {
    const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, (n | 0)));

    // Build goal-diff distribution: diff = H - A in [-goalCap, +goalCap]
    const offset = goalCap;
    const diffProb = Array(2 * goalCap + 1).fill(0);

    for (let h = 0; h <= goalCap; h++) {
      const row = scoreGrid?.[h] ?? {};
      for (let a = 0; a <= goalCap; a++) {
        const p = Number(row?.[a] ?? 0);
        if (!p) continue;

        const d = h - a;
        if (d < -goalCap || d > goalCap) continue;
        diffProb[d + offset] += p;
      }
    }

    // Prefix sums for fast ranges
    const pref = Array(diffProb.length + 1).fill(0);
    for (let i = 0; i < diffProb.length; i++) pref[i + 1] = pref[i] + diffProb[i];

    const sumIdx = (i0, i1) => {
      i0 = clampInt(i0, 0, diffProb.length - 1);
      i1 = clampInt(i1, 0, diffProb.length - 1);
      if (i1 < i0) return 0;
      return pref[i1 + 1] - pref[i0];
    };

    // Probabilities in diff domain (integer x)
    const P_ge = (x) => sumIdx(x + offset, goalCap + offset);                  // diff >= x
    const P_gt = (x) => P_ge(x + 1);                                           // diff > x
    const P_le = (x) => sumIdx(-goalCap + offset, x + offset);                 // diff <= x
    const P_lt = (x) => P_le(x - 1);                                           // diff < x
    const P_eq = (x) => Number(diffProb[x + offset] ?? 0);                     // diff == x

    // For HOME bet at AH line L:
    // Result depends on diff compared to threshold (-L)
    function evalHalfOrInt(line) {
      const isInteger = Math.abs(line - Math.round(line)) < 1e-12;
      const isHalf = !isInteger && Math.abs(line * 2 - Math.round(line * 2)) < 1e-12;

      if (!isInteger && !isHalf) {
        throw new Error("AH line must be integer or half (quarter handled separately).");
      }

      // Integer line: push possible
      if (isInteger) {
        const t = -Math.round(line); // push when diff == t
        return {
          win: P_gt(t),
          push: P_eq(t),
          lose: P_lt(t),
        };
      }

      // Half line: no push
      // Example line = -0.5 => t = 0.5 => win when diff >= 1, lose when diff <= 0
      const t = -line; // x.5
      const smallestWin = Math.floor(t) + 1;
      const largestLose = Math.floor(t);

      return {
        win: P_ge(smallestWin),
        push: 0,
        lose: P_le(largestLose),
      };
    }

    // Quarter line check: multiple of 0.25 but NOT multiple of 0.5
    function isQuarterLine(line) {
      const q = Math.round(line * 4);
      const isQuarterStep = Math.abs(line * 4 - q) < 1e-12;
      const isHalfStep = Math.abs(line * 2 - Math.round(line * 2)) < 1e-12;
      return isQuarterStep && !isHalfStep;
    }

    // Quarter lines are split stake into two adjacent half-lines
    function homeWPL(line) {
      if (!isQuarterLine(line)) return evalHalfOrInt(line);

      // Example: -0.25 => split between 0.0 and -0.5
      const lower = Math.floor(line * 2) / 2; // nearest lower half-step
      const upper = lower + 0.5;

      const a = evalHalfOrInt(lower);
      const b = evalHalfOrInt(upper);

      return {
        win: 0.5 * (a.win + b.win),
        push: 0.5 * (a.push + b.push),
        lose: 0.5 * (a.lose + b.lose),
      };
    }

    // Convert to DNB-style fair odds (push removed)
    function toFair(wpl) {
      const win = wpl.win;
      const push = wpl.push;
      const lose = wpl.lose;

      const denom = win + lose;
      const dnbWinProb = denom > 0 ? win / denom : 0;
      const fairOdds = dnbWinProb > 0 ? 1 / dnbWinProb : null;

      return {
        win,
        push,
        lose,
        dnbWinProb,
        fairOdds: fairOdds == null ? null : Number(fairOdds.toFixed(2)),
      };
    }

    const lines = [
      -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25,
       0,  0.25,  0.5,  0.75,  1,  1.25,  1.5,  1.75, 2
    ];

    return lines.map((line) => {
      const wpl = homeWPL(line);
      const f = toFair(wpl);

      return {
        line,
        home_win: Number(f.win.toFixed(6)),
        home_push: Number(f.push.toFixed(6)),
        home_lose: Number(f.lose.toFixed(6)),
        home_dnbWinProb: Number(f.dnbWinProb.toFixed(6)),
        home_fair: f.fairOdds,
      };
    });
  }

  // Expose API to browser
  window.MQ_AH = window.MQ_AH || {};
  window.MQ_AH.computeAsianHandicapFair = computeAsianHandicapFair;

  console.log("✅ ah.js loaded: window.MQ_AH.computeAsianHandicapFair ready");
})();
