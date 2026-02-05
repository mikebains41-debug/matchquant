// MatchQuant app.js (simple + reliable)
// Loads JSON -> populates UI -> calls engine.js -> shows custom modal

const $ = (id) => document.getElementById(id);

const leagueSelect = $("leagueSelect");
const fixtureSelect = $("fixtureSelect");
const homeSelect = $("homeSelect");
const awaySelect = $("awaySelect");
const simsInput = $("simsInput");
const homeAdvInput = $("homeAdvInput");
const baseGoalsInput = $("baseGoalsInput");
const capGoalsInput = $("capGoalsInput");
const runBtn = $("runBtn");
const statusLine = $("statusLine");
const outputCard = $("outputCard");

// modal
const mqModalBg = $("mqModalBg");
const mqBody = $("mqBody");
const mqClose = $("mqClose");

mqClose.addEventListener("click", () => (mqModalBg.style.display = "none"));
mqModalBg.addEventListener("click", (e) => {
  if (e.target === mqModalBg) mqModalBg.style.display = "none";
});

function showModal(text) {
  mqBody.textContent = text;
  mqModalBg.style.display = "flex";
}

function setStatus(t) { statusLine.textContent = t || ""; }

function clearSelect(sel, placeholder) {
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  sel.appendChild(opt);
  sel.value = "";
}

function fillSelect(sel, items, placeholder) {
  clearSelect(sel, placeholder);
  for (const v of items) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

let xgRaw = null;
let fixturesRaw = null;
let h2hRaw = null;

let leagues = [];
let teamsByLeague = new Map();
let fixtures = [];

function parseXgTables(xg) {
  leagues = [];
  teamsByLeague = new Map();

  const root = xg?.leagues || xg?.data || xg || {};
  for (const league of Object.keys(root)) {
    const lg = root[league];
    if (!lg || typeof lg !== "object") continue;
    leagues.push(league);
    const teams = Object.keys(lg);
    teamsByLeague.set(league, teams.sort());
  }
  leagues.sort();
}

function parseFixtures(fx) {
  const out = [];

  const root = fx?.fixtures || fx?.data || fx || [];
  if (Array.isArray(root)) {
    for (const f of root) {
      const league = f.league || f.competition || f.lg;
      const home = f.home || f.homeTeam || f.h;
      const away = f.away || f.awayTeam || f.a;
      if (!league || !home || !away) continue;
      out.push({
        id: f.id || `${league}__${home}__${away}`,
        league, home, away,
        date: f.date || f.kickoff || ""
      });
    }
  } else if (root && typeof root === "object") {
    for (const k of Object.keys(root)) {
      const f = root[k];
      const league = f.league || f.competition || f.lg;
      const home = f.home || f.homeTeam || f.h;
      const away = f.away || f.awayTeam || f.a;
      if (!league || !home || !away) continue;
      out.push({ id: f.id || k, league, home, away, date: f.date || f.kickoff || "" });
    }
  }
  return out;
}

function rebuildFixtureSelect(league) {
  const list = fixtures
    .filter(f => !league || f.league === league)
    .slice(0, 500) // safety
    .map(f => ({ id: f.id, label: `${f.home} vs ${f.away}` }));

  clearSelect(fixtureSelect, "Select Fixture (optional)");
  for (const it of list) {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.label;
    fixtureSelect.appendChild(o);
  }
}

function rebuildTeamSelects(league) {
  const teams = teamsByLeague.get(league) || [];
  fillSelect(homeSelect, teams, "Select home");
  fillSelect(awaySelect, teams, "Select away");
}

leagueSelect.addEventListener("change", () => {
  const lg = leagueSelect.value;
  rebuildFixtureSelect(lg);
  rebuildTeamSelects(lg);
});

fixtureSelect.addEventListener("change", () => {
  const id = fixtureSelect.value;
  if (!id) return;
  const f = fixtures.find(x => x.id === id);
  if (!f) return;
  leagueSelect.value = f.league;
  rebuildFixtureSelect(f.league);
  fixtureSelect.value = id;
  rebuildTeamSelects(f.league);
  homeSelect.value = f.home;
  awaySelect.value = f.away;
});

runBtn.addEventListener("click", () => {
  try {
    if (typeof window.runPrediction !== "function") {
      showModal("Engine not loaded. Make sure index.html loads engine.js before app.js");
      return;
    }

    const league = leagueSelect.value;
    const home = homeSelect.value;
    const away = awaySelect.value;

    if (!league || !home || !away) {
      showModal("Pick League + Home Team + Away Team.");
      return;
    }

    const result = window.runPrediction({
      league,
      home,
      away,
      sims: Number(simsInput.value || 10000),
      homeAdv: Number(homeAdvInput.value || 1.10),
      baseGoals: Number(baseGoalsInput.value || 1.35),
      capGoals: Number(capGoalsInput.value || 8),
      xgRaw,
      fixtures,
      h2hRaw
    });

    const text =
      `${result.fixture}\n\n` +
      `xG λ:\n${home}: ${result.xg.home.toFixed(2)}\n${away}: ${result.xg.away.toFixed(2)}\n\n` +
      `Win Probabilities:\n${home}: ${result.probs.home.toFixed(1)}%\nDraw: ${result.probs.draw.toFixed(1)}%\n${away}: ${result.probs.away.toFixed(1)}%\n\n` +
      `Most likely score: ${result.mostLikelyScore}\n\n` +
      `Markets:\nO/U 2.5 → ${result.markets.ou25}\nAsian Lean → ${result.markets.asianLean}`;

    // show modal (no "github.io says")
    showModal(text);

    // also render on page
    outputCard.style.display = "block";
    outputCard.innerHTML =
      `<div class="big">${result.fixture}</div>` +
      `<div class="muted" style="margin-top:6px">xG λ: ${home} ${result.xg.home.toFixed(2)} • ${away} ${result.xg.away.toFixed(2)}</div>` +
      `<div style="margin-top:10px">Win%: ${home} ${result.probs.home.toFixed(1)} • Draw ${result.probs.draw.toFixed(1)} • ${away} ${result.probs.away.toFixed(1)}</div>` +
      `<div style="margin-top:8px">Most likely score: <b>${result.mostLikelyScore}</b></div>` +
      `<div style="margin-top:8px">O/U 2.5: <b>${result.markets.ou25}</b> • Asian lean: <b>${result.markets.asianLean}</b></div>`;

  } catch (e) {
    console.error(e);
    showModal(`Prediction error:\n${e?.message || e}`);
  }
});

(async function init() {
  try {
    setStatus("Loading data…");
    [fixturesRaw, xgRaw, h2hRaw] = await Promise.all([
      loadJson("./fixtures.json"),
      loadJson("./xg_tables.json"),
      loadJson("./h2h.json")
    ]);

    parseXgTables(xgRaw);
    fixtures = parseFixtures(fixturesRaw);

    fillSelect(leagueSelect, leagues, "Select league");
    rebuildFixtureSelect("");
    clearSelect(homeSelect, "Select home");
    clearSelect(awaySelect, "Select away");

    setStatus(`Loaded: ${leagues.length} leagues • ${fixtures.length} fixtures`);
  } catch (e) {
    console.error(e);
    setStatus("Load failed (check JSON file names + formatting).");
    showModal(`Load error:\n${e?.message || e}`);
  }
})();
