/* MatchQuant engine.js — FULL REPLACEMENT (Deterministic Poisson + att/def tables + modal output) */

(function () {
  // ---------- Modal helpers (replaces alert) ----------
  window.showMQ = function (text) {
    const box = document.getElementById("mqContent");
    const modal = document.getElementById("mqModal");
    if (!box || !modal) return; // safety
    box.textContent = String(text || "");
    modal.classList.remove("hidden");
  };

  window.closeMQ = function () {
    const modal = document.getElementById("mqModal");
    if (!modal) return;
    modal.classList.add("hidden");
  };

  // ---------- core helpers ----------
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ");

  function clampInt(n, lo, hi) {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

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

  function num(x, fallback = null) {
    const v = Number(x);
    return isFinite(v) ? v : fallback;
  }

  // Convert decimal odds -> implied probability
  function impliedProbFromOdds(odds) {
    const o = num(odds, null);
    if (!o || o <= 1) return null;
    return 1 / o;
  }

  // EV from prob + decimal odds
  function evFromProbOdds(prob, odds) {
    const o = num(odds, null);
    if (o === null || o <= 1) return null;
    // EV per 1 unit stake
    return prob * (o - 1) - (1 - prob);
  }

  function evBadge(ev) {
    if (ev === null) return "";
    if (ev >= 0.06) return "✅ +EV (strong)";
    if (ev >= 0.02) return "✅ +EV";
    if (ev > -0.02) return "⚖️ near fair";
    return "❌ -EV";
  }

  // ---------- ATT/DEF model reader ----------
  function getLeagueRoot(xgRaw) {
    if (!xgRaw) return null;
    // support {leagues:{...}} or direct {...}
    return xgRaw.leagues ? xgRaw.leagues : xgRaw;
  }

  function buildTeamKeyMap(leagueObj) {
    const map = {};
    if (!leagueObj || typeof leagueObj !== "object") return map;
    Object.keys(leagueObj).forEach((k) => {
      if (!k || k.startsWith("__")) return;
      map[norm(k)] = k;
    });
    return map;
  }

  const ALIASES = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "tottenham hotspur": "tottenham",
    "wolves": "wolverhampton wanderers",
    "newcastle": "newcastle united",
    "inter": "inter milan",
    "ac milan": "milan",
  };

  function resolveTeamKey(team, teamKeyMap) {
    const n = norm(team);
    if (teamKeyMap[n]) return teamKeyMap[n];

    const a = ALIASES[n];
    if (a && teamKeyMap[a]) return teamKeyMap[a];

    // fuzzy contains match (last resort)
    const keys = Object.keys(teamKeyMap);
    const hit = keys.find((k) => k.includes(n) || n.includes(k));
    return hit ? teamKeyMap[hit] : null;
  }

  function leagueFactor(leagueObj) {
    const v = leagueObj && typeof leagueObj.__league_factor === "number" ? leagueObj.__league_factor : 1.0;
    return isFinite(v) && v > 0 ? v : 1.0;
  }

  function teamAttDef(leagueObj, teamKey) {
    const row = (leagueObj && teamKey) ? leagueObj[teamKey] : null;
    // expected: {att: number, def: number}
    const att = row && typeof row.att === "number" ? row.att : null;
    const def = row && typeof row.def === "number" ? row.def : null;
    return {
      att: (att && isFinite(att) && att > 0) ? att : 1.0,
      def: (def && isFinite(def) && def > 0) ? def : 1.0,
