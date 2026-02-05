/* MatchQuant app.js — FINAL HARD FILTER VERSION
   Guarantees removal of:
   - __league_factor
   - _meta
   - _league
   - any key starting with "_"
*/

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const uniqSorted = (arr) =>
    Array.from(new Set(arr))
      .filter(Boolean)
      .filter((x) => typeof x === "string")
      .filter((x) => !x.toLowerCase().includes("league_factor"))
      .filter((x) => !x.startsWith("_"))
      .sort((a, b) => a.localeCompare(b));

  function setSelectOptions(el, items, placeholder) {
    if (!el) return;
    el.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    el.appendChild(ph);
    items.forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      el.appendChild(o);
    });
  }

  function absUrl(f) {
    return new URL(f, window.location.href).toString();
  }

  async function loadJSON(f) {
    const res = await fetch(absUrl(f) + `?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${f} failed`);
    return res.json();
  }

  let fixtures = [];
  let xg = {};
  let h2h = {};

  const els = {
    league: $("league"),
    fixture: $("fixture"),
    home: $("home"),
    away: $("away"),
    run: $("runBtn"),
  };

  function normalizeFixtures(raw) {
    const arr = raw.fixtures || raw.data || raw || [];
    return arr.map((f, i) => ({
      id: f.id || i,
      league: f.league,
      home: f.home,
      away: f.away,
      date: f.date || "",
    }));
  }

  function leaguesFromFixtures() {
    return uniqSorted(fixtures.map((f) => f.league));
  }

  function teamsFromXG(league) {
    if (!xg.leagues || !xg.leagues[league]) return [];
    return uniqSorted(Object.keys(xg.leagues[league]));
  }

  function teamsFromFixtures(league) {
    return uniqSorted(
      fixtures
        .filter((f) => f.league === league)
        .flatMap((f) => [f.home, f.away])
    );
  }

  function rebuildLeague() {
    setSelectOptions(els.league, leaguesFromFixtures(), "Select league");
  }

  function rebuildTeams() {
    const lg = els.league.value;
    let teams = teamsFromXG(lg);
    if (!teams.length) teams = teamsFromFixtures(lg);
    setSelectOptions(els.home, teams, "Select home");
    setSelectOptions(els.away, teams, "Select away");
  }

  function rebuildFixtures() {
    els.fixture.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select fixture (optional)";
    els.fixture.appendChild(ph);

    fixtures
      .filter((f) => f.league === els.league.value)
      .forEach((f) => {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = `${f.home} vs ${f.away}`;
        els.fixture.appendChild(o);
      });
  }

  async function init() {
    const [fx, xgRaw, h2hRaw] = await Promise.all([
      loadJSON("fixtures.json"),
      loadJSON("xg_tables.json"),
      loadJSON("h2h.json"),
    ]);

    fixtures = normalizeFixtures(fx);
    xg = xgRaw;
    h2h = h2hRaw;

    rebuildLeague();
    rebuildTeams();
    rebuildFixtures();

    els.league.addEventListener("change", () => {
      rebuildFixtures();
      rebuildTeams();
    });

    els.fixture.addEventListener("change", () => {
      const f = fixtures.find((x) => x.id == els.fixture.value);
      if (!f) return;
      els.home.value = f.home;
      els.away.value = f.away;
    });

    els.run.addEventListener("click", () => {
      if (!window.runPrediction) {
        alert("Engine not loaded");
        return;
      }
      window.runPrediction({
        league: els.league.value,
        home: els.home.value,
        away: els.away.value,
        xg,
        fixtures,
        h2h,
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
