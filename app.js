/* MatchQuant app.js (diagnostic + robust loaders) */

const $ = (id) => document.getElementById(id);

const state = {
  xg: null,
  fixtures: null,
  h2h: null,
  leagueList: [],
  leagueToFixtures: new Map(),
  teamByLeague: new Map(),
};

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
  console.log(text);
}

function addStatusChip(label, ok, detail = "") {
  const wrap = $("chips");
  if (!wrap) return;
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.innerHTML = `
    <span class="dot ${ok ? "ok" : "bad"}"></span>
    <span>${label}${detail ? ` (${detail})` : ""}</span>
  `;
  wrap.appendChild(chip);
}

async function fetchJson(path) {
  // Cache-bust GitHub Pages/CDN
  const url = `${path}?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return await res.json();
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function resetSelect(sel) {
  while (sel.options.length > 1) sel.remove(1); // keep placeholder option
}

function addOption(sel, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  sel.appendChild(opt);
}

function parseFixtures(fixtures) {
  // fixtures.json is an array of objects: { league, home, away, date, odds }
  const leagueList = uniq(fixtures.map((f) => f.league)).sort();
  const leagueToFixtures = new Map();
  const teamByLeague = new Map();

  for (const league of leagueList) {
    const list = fixtures.filter((f) => f.league === league);
    leagueToFixtures.set(league, list);

    const teams = uniq(
      list.flatMap((f) => [f.home, f.away].filter(Boolean))
    ).sort();
    teamByLeague.set(league, teams);
  }

  return { leagueList, leagueToFixtures, teamByLeague };
}

function buildLeagueDropdown() {
  const leagueSel = $("league");
  if (!leagueSel) return;

  resetSelect(leagueSel);
  state.leagueList.forEach((lg) => addOption(leagueSel, lg, lg));
}

function buildFixtureDropdown(league) {
  const fixtureSel = $("fixture");
  if (!fixtureSel) return;

  resetSelect(fixtureSel);
  const list = state.leagueToFixtures.get(league) || [];
  for (const f of list) {
    const key = `${f.league}__${f.home}__${f.away}__${f.date || ""}`;
    const label = `${f.home} vs ${f.away}${f.date ? ` • ${f.date}` : ""}`;
    addOption(fixtureSel, key, label);
  }
}

function buildTeamDropdowns(league) {
  const homeSel = $("homeTeam");
  const awaySel = $("awayTeam");
  if (!homeSel || !awaySel) return;

  resetSelect(homeSel);
  resetSelect(awaySel);

  const teams = state.teamByLeague.get(league) || [];
  for (const t of teams) {
    addOption(homeSel, t, t);
    addOption(awaySel, t, t);
  }
}

function onLeagueChange() {
  const league = $("league").value;
  if (!league) return;

  buildFixtureDropdown(league);
  buildTeamDropdowns(league);
  setStatus(`League selected: ${league}. Fixtures: ${(state.leagueToFixtures.get(league) || []).length}`);
}

function onFixtureChange() {
  const league = $("league").value;
  const fixtureKey = $("fixture").value;
  if (!league || !fixtureKey) return;

  const list = state.leagueToFixtures.get(league) || [];
  const match = list.find((f) => fixtureKey.includes(`${f.home}__${f.away}`) && fixtureKey.includes(f.league));
  if (!match) return;

  $("homeTeam").value = match.home;
  $("awayTeam").value = match.away;
}

function wireEvents() {
  $("league")?.addEventListener("change", onLeagueChange);
  $("fixture")?.addEventListener("change", onFixtureChange);

  $("runBtn")?.addEventListener("click", () => {
    // For now just prove selection works
    const league = $("league").value;
    const home = $("homeTeam").value;
    const away = $("awayTeam").value;

    if (!league) return setStatus("Pick a league first.");
    if (!home || !away) return setStatus("Pick home + away teams.");
    setStatus(`✅ Ready: ${league} — ${home} vs ${away} (Run logic next)`);
  });
}

async function init() {
  setStatus("Loading data…");

  // Clear chips
  const chips = $("chips");
  if (chips) chips.innerHTML = "";

  // 1) Load fixtures FIRST (league list comes from here)
  try {
    state.fixtures = await fetchJson("./fixtures.json");
    const parsed = parseFixtures(state.fixtures);
    state.leagueList = parsed.leagueList;
    state.leagueToFixtures = parsed.leagueToFixtures;
    state.teamByLeague = parsed.teamByLeague;

    addStatusChip("fixtures.json", true, `${state.fixtures.length}`);
  } catch (e) {
    console.error(e);
    addStatusChip("fixtures.json", false, String(e.message || e));
    setStatus("❌ fixtures.json failed to load. Open DevTools/Console or send screenshot of chips.");
    // still wire events so you can see UI
    wireEvents();
    return;
  }

  // 2) Load xg tables (optional for dropdowns)
  try {
    state.xg = await fetchJson("./xg_tables.json");
    // Count teams roughly
    const leagues = Object.keys(state.xg || {});
    let teams = 0;
    for (const lg of leagues) teams += Object.keys(state.xg[lg] || {}).length;
    addStatusChip("xg_tables.json", true, `${teams} teams`);
  } catch (e) {
    console.error(e);
    addStatusChip("xg_tables.json", false, String(e.message || e));
  }

  // 3) Load h2h (optional)
  try {
    state.h2h = await fetchJson("./h2h.json");
    addStatusChip("h2h.json", true, "ok");
  } catch (e) {
    console.error(e);
    addStatusChip("h2h.json", false, String(e.message || e));
  }

  // Build UI
  buildLeagueDropdown();
  wireEvents();

  setStatus(`Loaded. Leagues: ${state.leagueList.length} • Fixtures: ${state.fixtures.length}`);
}

document.addEventListener("DOMContentLoaded", init);
