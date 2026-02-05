/* MatchQuant - single-file client engine (no build tools).
   Loads:
   - xg_tables.json  (league -> team -> {att, def})
   - fixtures.json   (array of fixtures)
   - h2h.json        (optional)
   - league-champ.csv (league factor table)
*/

const els = {
  statusLine: document.getElementById("statusLine"),
  dotXg: document.getElementById("dotXg"),
  dotFix: document.getElementById("dotFix"),
  dotH2h: document.getElementById("dotH2h"),
  pillXg: document.getElementById("pillXg"),
  pillFix: document.getElementById("pillFix"),
  pillH2h: document.getElementById("pillH2h"),

  leagueSelect: document.getElementById("leagueSelect"),
  fixtureSelect: document.getElementById("fixtureSelect"),
  homeSelect: document.getElementById("homeSelect"),
  awaySelect: document.getElementById("awaySelect"),

  simsInput: document.getElementById("simsInput"),
  homeAdvInput: document.getElementById("homeAdvInput"),
  baseGoalsInput: document.getElementById("baseGoalsInput"),
  maxGoalsInput: document.getElementById("maxGoalsInput"),
  runBtn: document.getElementById("runBtn"),

  singleOut: document.getElementById("singleOut"),
  h2hText: document.getElementById("h2hText"),

  fixturesMeta: document.getElementById("fixturesMeta"),
  fixturesBody: document.getElementById("fixturesBody"),
};

const state = {
  xg: null,
  fixtures: [],
  h2h: null,
  leagueFactor: new Map(),  // league -> factor
  leagues: [],
  ready: { xg:false, fix:false, h2h:false, lf:false }
};

function setPill(dotEl, pillEl, ok, text){
  dotEl.classList.remove("ok","bad");
  dotEl.classList.add(ok ? "ok" : "bad");
  pillEl.textContent = text;
}

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

async function safeFetchJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return await r.json();
}

async function safeFetchText(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return await r.text();
}

function parseCSV(csvText){
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(s => s.trim());
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = lines[i].split(",").map(s => s.trim());
    const row = {};
    for (let j=0;j<header.length;j++) row[header[j]] = cols[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function buildLeagueFactor(rows){
  // flexible: tries to find league name + factor columns
  // accepted column names: league, League, competition, name ; factor, Factor, lf
  const leagueKeys = ["league","League","competition","Competition","name","Name"];
  const factorKeys = ["factor","Factor","lf","LF","league_factor","LeagueFactor"];
  const m = new Map();

  for (const r of rows){
    let lk=null, fk=null;
    for (const k of leagueKeys) if (k in r) { lk = r[k]; break; }
    for (const k of factorKeys) if (k in r) { fk = r[k]; break; }

    // fallback: first 2 columns
    if (!lk || !fk){
      const keys = Object.keys(r);
      if (keys.length >= 2){
        lk = lk || r[keys[0]];
        fk = fk || r[keys[1]];
      }
    }
    const league = (lk || "").trim();
    const factor = Number((fk || "").trim());
    if (league && Number.isFinite(factor) && factor > 0) m.set(league, factor);
  }
  return m;
}

function uniq(arr){
  return [...new Set(arr)];
}

function sortAlpha(arr){
  return [...arr].sort((a,b)=>a.localeCompare(b));
}

function scorelineKey(h,a){ return `${h}-${a}`; }

// Poisson sampler (Knuth)
function poisson(lambda){
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1.0;
  do {
    k++;
    p *= Math.random();
  } while (p > L && k < 64);
  return k - 1;
}

function simMatch({lambdaH, lambdaA, sims, maxGoals}){
  // returns distributions + derived markets
  const scoreCounts = new Map();
  let homeW=0, draw=0, awayW=0;
  let over25=0, under25=0;

  for (let i=0;i<sims;i++){
    let hg = poisson(lambdaH);
    let ag = poisson(lambdaA);
    if (hg > maxGoals) hg = maxGoals;
    if (ag > maxGoals) ag = maxGoals;

    const k = scorelineKey(hg,ag);
    scoreCounts.set(k, (scoreCounts.get(k) || 0) + 1);

    if (hg > ag) homeW++;
    else if (hg === ag) draw++;
    else awayW++;

    const tot = hg + ag;
    if (tot > 2) over25++;
    else under25++;
  }

  // most likely scoreline
  let bestKey="0-0", bestC=-1;
  for (const [k,c] of scoreCounts.entries()){
    if (c > bestC){ bestC = c; bestKey = k; }
  }

  const pct = (n)=> Math.round((n / sims) * 100);
  return {
    bestScore: bestKey,
    pH: pct(homeW),
    pD: pct(draw),
    pA: pct(awayW),
    pOver25: pct(over25),
    pUnder25: pct(under25),
  };
}

function getTeamXg(league, team){
  const L = state.xg?.[league];
  if (!L) return { att: 1.0, def: 1.0, missing: true };
  const t = L[team];
  if (!t) return { att: 1.0, def: 1.0, missing: true };
  const att = Number(t.att);
  const def = Number(t.def);
  if (!Number.isFinite(att) || !Number.isFinite(def)) return { att: 1.0, def: 1.0, missing: true };
  return { att, def, missing: false };
}

function computeLambdas({league, home, away, baseGoals, homeAdv}){
  const lf = state.leagueFactor.get(league) ?? 1.0;

  const hx = getTeamXg(league, home);
  const ax = getTeamXg(league, away);

  // Model:
  // home lambda: base * leagueFactor * homeAdv * homeAtt * awayDef
  // away lambda: base * leagueFactor * awayAtt * homeDef
  const lambdaH = clamp(baseGoals * lf * homeAdv * hx.att * ax.def, 0.05, 4.25);
  const lambdaA = clamp(baseGoals * lf * ax.att * hx.def, 0.05, 4.25);

  return { lambdaH, lambdaA, lf, hx, ax };
}

function matchId(league, home, away){
  return `${league}__${home}__${away}`.toLowerCase();
}

function readLastH2H(league, home, away){
  if (!state.h2h) return null;

  // support multiple shapes:
  // 1) key-based: "league__home__away": {...}
  // 2) array of objects
  // 3) nested maps
  const id1 = matchId(league, home, away);
  const id2 = matchId(league, away, home);

  if (state.h2h[id1]) return state.h2h[id1];
  if (state.h2h[id2]) return state.h2h[id2];

  if (Array.isArray(state.h2h)){
    const found = state.h2h.find(x => {
      const l = (x.league || x.League || "").toString();
      const h = (x.home || x.Home || x.h || "").toString();
      const a = (x.away || x.Away || x.a || "").toString();
      return l === league && ((h === home && a === away) || (h === away && a === home));
    });
    return found || null;
  }

  // nested: h2h[league][home][away]
  if (state.h2h[league]?.[home]?.[away]) return state.h2h[league][home][away];
  if (state.h2h[league]?.[away]?.[home]) return state.h2h[league][away][home];

  return null;
}

function formatH2H(h2hObj){
  if (!h2hObj) return "—";

  // try to read common fields
  const score = h2hObj.score || h2hObj.Score || h2hObj.result || h2hObj.Result;
  const cards = h2hObj.cards || h2hObj.Cards;
  const corners = h2hObj.corners || h2hObj.Corners;
  const date = h2hObj.date || h2hObj.Date;

  const parts = [];
  if (score) parts.push(`Score: ${score}`);
  if (cards != null && cards !== "") parts.push(`Cards: ${cards}`);
  if (corners != null && corners !== "") parts.push(`Corners: ${corners}`);
  if (date) parts.push(`Date: ${date}`);

  return parts.length ? parts.join(" • ") : JSON.stringify(h2hObj).slice(0, 160);
}

function clearOptions(sel, keepFirst=true){
  const start = keepFirst ? 1 : 0;
  while (sel.options.length > start) sel.remove(start);
}

function addOption(sel, value, label){
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label ?? value;
  sel.appendChild(o);
}

function updateRunEnabled(){
  const ok = !!els.leagueSelect.value && !!els.homeSelect.value && !!els.awaySelect.value;
  els.runBtn.disabled = !ok;
}

function renderSingleOutput(payload){
  const { league, home, away, sims, baseGoals, homeAdv, maxGoals } = payload;
  const { lambdaH, lambdaA, lf, hx, ax } = computeLambdas({ league, home, away, baseGoals, homeAdv });
  const res = simMatch({ lambdaH, lambdaA, sims, maxGoals });

  const missingNote = (hx.missing || ax.missing) ? `<div class="mini" style="margin-top:6px;color:#f59e0b">⚠ Missing xG for ${hx.missing ? home : ""}${hx.missing && ax.missing ? " & " : ""}${ax.missing ? away : ""} → using neutral 1.00/1.00</div>` : "";

  els.singleOut.innerHTML = `
    <div class="split">
      <div>
        <div class="k">Model</div>
        <div style="font-weight:800;font-size:16px">${home} vs ${away}</div>
        <div class="mini">${league} • League factor ${lf.toFixed(2)} • λ ${lambdaH.toFixed(2)} / ${lambdaA.toFixed(2)}</div>
      </div>
      <div class="right">
        <div class="k">Pred</div>
        <div style="font-weight:900;font-size:18px" class="mono">${res.bestScore}</div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="row" style="justify-content:space-between">
      <div class="badge b-good">1X2: H ${res.pH}% • D ${res.pD}% • A ${res.pA}%</div>
      <div class="badge b-warn">O/U 2.5: Over ${res.pOver25}% • Under ${res.pUnder25}%</div>
    </div>
    ${missingNote}
  `;

  const h2hObj = readLastH2H(league, home, away);
  els.h2hText.textContent = formatH2H(h2hObj);
}

function renderFixturesTable(league){
  const list = state.fixtures.filter(f => (f.league || f.League || "") === league);
  els.fixturesMeta.textContent = `${league} • ${list.length} fixture(s)`;

  if (!list.length){
    els.fixturesBody.innerHTML = `<tr><td colspan="5" class="k">No fixtures found for this league in fixtures.json</td></tr>`;
    return;
  }

  const sims = clamp(Number(els.simsInput.value) || 10000, 2000, 200000);
  const baseGoals = clamp(Number(els.baseGoalsInput.value) || 1.35, 0.8, 1.8);
  const homeAdv = clamp(Number(els.homeAdvInput.value) || 1.10, 1.00, 1.25);
  const maxGoals = clamp(Number(els.maxGoalsInput.value) || 8, 6, 12);

  let html = "";
  let idx = 1;

  for (const f of list){
    const home = f.home || f.Home || f.h || f.team_home || "";
    const away = f.away || f.Away || f.a || f.team_away || "";
    const date = f.date || f.Date || f.kickoff || "";
    const comp = f.league || f.League || league;

    if (!home || !away) continue;

    const { lambdaH, lambdaA } = computeLambdas({ league: comp, home, away, baseGoals, homeAdv });
    const r = simMatch({ lambdaH, lambdaA, sims, maxGoals });

    const ou = (r.pOver25 >= 55) ? `<span class="badge b-warn">Over ${r.pOver25}%</span>`
             : (r.pUnder25 >= 55) ? `<span class="badge b-warn">Under ${r.pUnder25}%</span>`
             : `<span class="badge">Lean: Over ${r.pOver25}%</span>`;

    html += `
      <tr data-home="${escapeHtml(home)}" data-away="${escapeHtml(away)}" data-league="${escapeHtml(comp)}" style="cursor:pointer">
        <td class="k">${idx++}</td>
        <td>
          <div class="match">${escapeHtml(home)} vs ${escapeHtml(away)}</div>
          <div class="meta">${escapeHtml(comp)} • ${escapeHtml(date)}</div>
          <div class="mini mono">λ ${lambdaH.toFixed(2)} / ${lambdaA.toFixed(2)}</div>
        </td>
        <td class="mono" style="font-weight:900">${escapeHtml(r.bestScore)}</td>
        <td class="k">H ${r.pH}% • D ${r.pD}% • A ${r.pA}%</td>
        <td>${ou}</td>
      </tr>
    `;
  }

  els.fixturesBody.innerHTML = html || `<tr><td colspan="5" class="k">No usable fixtures (missing home/away names)</td></tr>`;

  // tap row -> fill single predictor
  for (const tr of els.fixturesBody.querySelectorAll("tr[data-home]")){
    tr.addEventListener("click", () => {
      const comp = tr.getAttribute("data-league");
      const home = tr.getAttribute("data-home");
      const away = tr.getAttribute("data-away");

      els.leagueSelect.value = comp;
      onLeagueChange(); // rebuild team lists

      els.homeSelect.value = home;
      els.awaySelect.value = away;
      updateRunEnabled();

      renderSingleOutput({
        league: comp, home, away,
        sims: clamp(Number(els.simsInput.value) || 10000, 2000, 200000),
        baseGoals: clamp(Number(els.baseGoalsInput.value) || 1.35, 0.8, 1.8),
        homeAdv: clamp(Number(els.homeAdvInput.value) || 1.10, 1.00, 1.25),
        maxGoals: clamp(Number(els.maxGoalsInput.value) || 8, 6, 12),
      });
    });
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function onLeagueChange(){
  const league = els.leagueSelect.value;

  clearOptions(els.fixtureSelect, true);
  clearOptions(els.homeSelect, true);
  clearOptions(els.awaySelect, true);

  els.fixtureSelect.disabled = !league;
  els.homeSelect.disabled = !league;
  els.awaySelect.disabled = !league;

  if (!league){
    updateRunEnabled();
    return;
  }

  // fixtures dropdown for that league
  const list = state.fixtures
    .filter(f => (f.league || f.League || "") === league)
    .map(f => {
      const home = f.home || f.Home || "";
      const away = f.away || f.Away || "";
      const date = f.date || f.Date || "";
      return { home, away, date };
    })
    .filter(x => x.home && x.away);

  for (const f of list){
    addOption(els.fixtureSelect, `${f.home}|||${f.away}`, `${f.home} vs ${f.away}${f.date ? " • "+f.date : ""}`);
  }

  // teams list from xg_tables league keys
  const teams = sortAlpha(Object.keys(state.xg?.[league] || {}));
  for (const t of teams){
    addOption(els.homeSelect, t, t);
    addOption(els.awaySelect, t, t);
  }

  // if fixtures include teams not in xg list, still add them so UI works
  const extra = uniq(list.flatMap(x => [x.home, x.away])).filter(t => !teams.includes(t));
  for (const t of sortAlpha(extra)){
    addOption(els.homeSelect, t, `${t} (no xG)`);
    addOption(els.awaySelect, t, `${t} (no xG)`);
  }

  updateRunEnabled();
  renderFixturesTable(league);
}

function onFixtureChange(){
  const v = els.fixtureSelect.value;
  if (!v) return;
  const [home, away] = v.split("|||");
  if (home && away){
    els.homeSelect.value = home;
    els.awaySelect.value = away;
    updateRunEnabled();
  }
}

function attachEvents(){
  els.leagueSelect.addEventListener("change", onLeagueChange);
  els.fixtureSelect.addEventListener("change", onFixtureChange);
  els.homeSelect.addEventListener("change", updateRunEnabled);
  els.awaySelect.addEventListener("change", updateRunEnabled);

  for (const x of [els.simsInput, els.homeAdvInput, els.baseGoalsInput, els.maxGoalsInput]){
    x.addEventListener("change", () => {
      if (els.leagueSelect.value) renderFixturesTable(els.leagueSelect.value);
    });
  }

  els.runBtn.addEventListener("click", () => {
    const league = els.leagueSelect.value;
    const home = els.homeSelect.value;
    const away = els.awaySelect.value;

    const sims = clamp(Number(els.simsInput.value) || 10000, 2000, 200000);
    const baseGoals = clamp(Number(els.baseGoalsInput.value) || 1.35, 0.8, 1.8);
    const homeAdv = clamp(Number(els.homeAdvInput.value) || 1.10, 1.00, 1.25);
    const maxGoals = clamp(Number(els.maxGoalsInput.value) || 8, 6, 12);

    renderSingleOutput({ league, home, away, sims, baseGoals, homeAdv, maxGoals });
  });
}

async function boot(){
  attachEvents();

  // Register service worker (optional)
  if ("serviceWorker" in navigator){
    try { await navigator.serviceWorker.register("./sw.js"); } catch(e){}
  }

  // Load xG
  try {
    state.xg = await safeFetchJson("./xg_tables.json");
    state.ready.xg = true;

    const leagues = Object.keys(state.xg || {});
    state.leagues = sortAlpha(leagues);

    // populate league select
    for (const l of state.leagues) addOption(els.leagueSelect, l, l);

    // count teams with xG
    let teamCount = 0;
    for (const l of leagues) teamCount += Object.keys(state.xg[l] || {}).length;

    setPill(els.dotXg, els.pillXg, true, `xG loaded (${teamCount} teams)`);
  } catch (e){
    setPill(els.dotXg, els.pillXg, false, `xG failed`);
    console.error(e);
  }

  // Load fixtures
  try {
    const fx = await safeFetchJson("./fixtures.json");
    state.fixtures = Array.isArray(fx) ? fx : (fx.fixtures || []);
    state.ready.fix = true;
    setPill(els.dotFix, els.pillFix, true, `fixtures loaded (${state.fixtures.length})`);
  } catch (e){
    setPill(els.dotFix, els.pillFix, false, `fixtures failed`);
    console.error(e);
  }

  // Load H2H (optional)
  try {
    state.h2h = await safeFetchJson("./h2h.json");
    state.ready.h2h = true;
    setPill(els.dotH2h, els.pillH2h, true, `H2H loaded`);
  } catch (e){
    // Not fatal
    state.h2h = null;
    setPill(els.dotH2h, els.pillH2h, false, `H2H missing`);
  }

  // Load league factors (optional)
  try {
    const csv = await safeFetchText("./league-champ.csv");
    const rows = parseCSV(csv);
    state.leagueFactor = buildLeagueFactor(rows);
    state.ready.lf = true;
  } catch (e){
    state.leagueFactor = new Map();
    state.ready.lf = false;
  }

  // status line
  const fixN = state.fixtures.length;
  let xgTeams = 0;
  for (const l of Object.keys(state.xg || {})) xgTeams += Object.keys(state.xg[l] || {}).length;

  const lfExample = state.leagues.length ? (state.leagueFactor.get(state.leagues[0]) ?? 1.00) : 1.00;
  els.statusLine.textContent = `Loaded. Fixtures: ${fixN} | Teams with xG: ${xgTeams} | League factor example: ${lfExample.toFixed(2)}`;

  // Enable if we have at least xg + fixtures
  const ok = state.ready.xg && state.ready.fix;
  els.leagueSelect.disabled = !ok;

  // If fixtures exist but leagues missing, build leagues from fixtures
  if (!state.leagues.length && state.fixtures.length){
    const leagues = sortAlpha(uniq(state.fixtures.map(f => f.league || f.League || "").filter(Boolean)));
    state.leagues = leagues;
    clearOptions(els.leagueSelect, true);
    for (const l of leagues) addOption(els.leagueSelect, l, l);
  }

  // If only one league, auto-select it
  if (state.leagues.length === 1){
    els.leagueSelect.value = state.leagues[0];
    onLeagueChange();
  }

  // If not ready, show in table
  if (!ok){
    els.fixturesBody.innerHTML = `<tr><td colspan="5" class="k">Missing required files. Need xg_tables.json + fixtures.json</td></tr>`;
  }
}

boot();
