/* MatchQuant app.js — FULL REPLACEMENT (FINAL) */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const uniq = (a) => [...new Set(a)].sort((x, y) => x.localeCompare(y));

  let fixtures = [];
  let xgRaw = {};
  let h2hRaw = {};

  const leagueSel = $("league");
  const fixtureSel = $("fixture");
  const homeSel = $("home");
  const awaySel = $("away");
  const runBtn = $("runBtn");

  function abs(file) {
    return new URL(file, location.href).toString();
  }

  async function loadJSON(file) {
    const res = await fetch(abs(file) + `?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(file + " failed");
    return res.json();
  }

  function normalizeFixtures(raw) {
    const arr = Array.isArray(raw) ? raw : raw.fixtures || [];
    return arr
      .filter(f => f.league && f.home && f.away)
      .map((f, i) => ({
        id: `${f.league}__${f.home}__${f.away}__${i}`,
        league: f.league,
        home: f.home,
        away: f.away,
        date: f.date || ""
      }));
  }

  function leaguesFromFixtures() {
    return uniq(fixtures.map(f => f.league));
  }

  function teamsForLeague(league) {
    const teamsFromFixtures = fixtures
      .filter(f => f.league === league)
      .flatMap(f => [f.home, f.away]);

    const teamsFromXG =
      xgRaw[league]
        ? Object.keys(xgRaw[league]).filter(k => !k.startsWith("__"))
        : [];

    return uniq([...teamsFromFixtures, ...teamsFromXG]);
  }

  function rebuildSelect(sel, items, label) {
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
