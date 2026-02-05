/* MatchQuant app.js — FULL REPLACEMENT */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const uniq = (arr) =>
    [...new Set(arr.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );

  const abs = (f) => new URL(f, location.href).toString();

  async function loadJSON(file) {
    const res = await fetch(abs(file) + `?cb=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${file} failed`);
    return res.json();
  }

  let fixtures = [];
  let xg = {};
  let h2h = {};

  function normalizeFixtures(raw) {
    const arr = Array.isArray(raw) ? raw : raw.fixtures || [];
    return arr
      .map((f, i) => ({
        id: f.id || `${f.league}_${i}`,
        league: f.league,
        home: f.home,
        away: f.away,
        date: f.date || "",
      }))
      .filter(f => f.league && f.home && f.away);
  }

  function leaguesFromFixtures() {
    return uniq(fixtures.map(f => f.league));
  }

  function teamsFromLeague(league) {
    let teams = [];

    if (xg[league]) {
      teams = Object.keys(xg[league]).filter(
        t => !t.startsWith("__")
      );
    }

    if (!teams.length) {
      fixtures
        .filter(f => f.league === league)
        .forEach(f => {
          teams.push(f.home, f.away);
        });
    }

    return uniq(teams);
  }

  function fillSelect(el, items, label) {
    el.innerHTML = "";
    const o = document.createElement("option");
    o.value = "";
    o.textContent = label;
    el.appendChild(o);

    items.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  function rebuildLeague() {
    fillSelect($("league"), leaguesFromFixtures(), "Select league");
  }

  function rebuildFixtures(league) {
    const list = fixtures.filter(f => f.league === league);
    $("fixture").innerHTML = "<option value=''>Select fixture (optional)</option>";
    list.forEach(f => {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = `${f.home} vs ${f.away} ${f.date ? `(${f.date})` : ""}`;
      $("fixture").appendChild(o);
    });
  }

  function rebuildTeams(league) {
    const teams = teamsFromLeague(league);
    fillSelect($("home"), teams, "Select home");
    fillSelect($("away"), teams, "Select away");
  }

  function run() {
    if (!window.runPrediction) {
      alert("Engine not loaded");
      return;
    }

    window.runPrediction({
      league: $("league").value,
      home: $("home").value,
      away: $("away").value,
      sims: +$("sims").value,
      homeAdv: +$("homeAdv").value,
      baseGoals: +$("baseGoals").value,
      capGoals: +$("capGoals").value,
      xg,
      fixtures,
      h2h,
    });
  }

  async function init() {
    try {
      fixtures = normalizeFixtures(await loadJSON("fixtures.json"));
      xg = await loadJSON("xg_tables.json");
      h2h = await loadJSON("h2h.json");

      rebuildLeague();

      $("league").onchange = () => {
        rebuildFixtures($("league").value);
        rebuildTeams($("league").value);
      };

      $("fixture").onchange = () => {
        const f = fixtures.find(x => x.id === $("fixture").value);
        if (f) {
          $("home").value = f.home;
          $("away").value = f.away;
        }
      };

      $("runBtn").onclick = run;

      $("footerLoaded").textContent =
        `Loaded: ${leaguesFromFixtures().length} leagues • ${fixtures.length} fixtures`;
    } catch (e) {
      console.error(e);
      alert("Data failed to load");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
