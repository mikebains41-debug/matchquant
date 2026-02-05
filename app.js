/* MatchQuant PRO (flat fixtures.json support)
   - fixtures.json can be FLAT ARRAY: [{league,home,away,date,odds:{home,draw,away,over25,under25,bttsYes,bttsNo}}, ...]
   - OR league-grouped object (still supported)
   - Table includes: Pred, 1X2, O/U2.5, BTTS, AH, Corners, Cards, EV(+ best market), Pro Grade
*/

const $ = (id) => document.getElementById(id);

const state = {
  xg: null,          // xg_tables.json (league -> team -> params)
  fixturesRaw: null, // fixtures.json (flat or grouped)
  fixturesByLeague: {}, // normalized map: league -> [fixtures]
  h2h: null,         // h2h.json (optional)
  leagues: [],
  league: null,
  fixtureList: [],
};

function setStatus(dotId, textId, ok, text) {
  const dot = $(dotId);
  const el = $(textId);
  if (dot) dot.className = ok ? "dot ok" : "dot";
  if (el) el.textContent = text;
}

function safeNum(x, fallback = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function normTeamName(s){ return String(s || "").trim(); }

function loadJSON(path){
  return fetch(path, { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}`);
    return r.json();
  });
}

/* ---------- Normalize fixtures ---------- */
function normalizeFixtures(raw){
  const out = {};

  // Case A: flat array
  if (Array.isArray(raw)){
    for (const fx of raw){
      const league = String(fx.league || fx.League || "").trim();
      if (!league) continue;
      const home = normTeamName(fx.home || fx.h || fx.HomeTeam);
      const away = normTeamName(fx.away || fx.a || fx.AwayTeam);
      if (!home || !away) continue;

      const obj = {
        league,
        home,
        away,
        date: fx.date || fx.Date || "",
        odds: fx.odds || null
      };

      if (!out[league]) out[league] = [];
      out[league].push(obj);
    }
    return out;
  }

  // Case B: league-grouped object
  if (raw && typeof raw === "object"){
    for (const league of Object.keys(raw)){
      const v = raw[league];
      let arr = [];
      if (Array.isArray(v)) arr = v;
      else if (Array.isArray(v?.fixtures)) arr = v.fixtures;

      out[league] = (arr || []).map(fx => ({
        league,
        home: normTeamName(fx.home || fx.h || fx.HomeTeam),
        away: normTeamName(fx.away || fx.a || fx.AwayTeam),
        date: fx.date || fx.Date || "",
        odds: fx.odds || null
      })).filter(fx => fx.home && fx.away);
    }
  }

  return out;
}

function countFixturesMap(map){
  let n = 0;
  for (const lg of Object.keys(map)) n += (map[lg] || []).length;
  return n;
}

/* ---------- Leagues ---------- */
function leaguesFromData(){
  const set = new Set();
  if (state.xg) Object.keys(state.xg).forEach(x => set.add(x));
  if (state.fixturesByLeague) Object.keys(state.fixturesByLeague).forEach(x => set.add(x));
  if (state.h2h) Object.keys(state.h2h).forEach(x => set.add(x));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

/* ---------- Team Params ---------- */
function teamParams(league, team){
  const t = state.xg?.[league]?.[team];
  if (!t) return null;
  return {
    att: safeNum(t.att, 1.0),
    def: safeNum(t.def, 1.0),
    corners_for: safeNum(t.corners_for, null),
    corners_against: safeNum(t.corners_against, null),
    cards_for: safeNum(t.cards_for, null),
    cards_against: safeNum(t.cards_against, null),
  };
}

function getLeagueTeams(league){
  const teamsObj = state.xg?.[league] || {};
  return Object.keys(teamsObj).sort((a,b)=>a.localeCompare(b));
}

function deriveLeagueFactor(){
  // Keep simple: fixed 1.00 unless you later add a leagueFactor in a separate config.
  return 1.00;
}

/* ---------- RNG & Poisson ---------- */
function poisson(lambda){
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

/* ---------- Model ---------- */
function simulateMatch({ league, home, away, sims, homeAdv, baseGoals, maxGoals }){
  const hp = teamParams(league, home);
  const ap = teamParams(league, away);
  if (!hp || !ap) throw new Error(`Missing team xG params for ${home} or ${away}`);

  const leagueFactor = deriveLeagueFactor();

  let lambdaH = baseGoals * hp.att * ap.def * leagueFactor * homeAdv;
  let lambdaA = baseGoals * ap.att * hp.def * leagueFactor;

  lambdaH = clamp(lambdaH, 0.1, 4.5);
  lambdaA = clamp(lambdaA, 0.1, 4.5);

  const maxCap = Math.max(5, Math.min(12, Math.floor(maxGoals)));

  const scoreCount = new Map();
  let homeW=0, draw=0, awayW=0;
  let over25=0, btts=0;
  let sumGoals=0;
  const gdCount = new Map();

  for (let i=0;i<sims;i++){
    let gH = poisson(lambdaH);
    let gA = poisson(lambdaA);
    if (gH > maxCap) gH = maxCap;
    if (gA > maxCap) gA = maxCap;

    const key = `${gH}-${gA}`;
    scoreCount.set(key, (scoreCount.get(key)||0)+1);

    if (gH>gA) homeW++;
    else if (gH===gA) draw++;
    else awayW++;

    const tg = gH+gA;
    sumGoals += tg;
    if (tg>=3) over25++;
    if (gH>=1 && gA>=1) btts++;

    const gd = gH - gA;
    gdCount.set(gd, (gdCount.get(gd)||0)+1);
  }

  let bestScore = "1-1", bestN = -1;
  for (const [k,v] of scoreCount.entries()){
    if (v>bestN){bestN=v; bestScore=k;}
  }

  const pHome = homeW/sims;
  const pDraw = draw/sims;
  const pAway = awayW/sims;
  const pOver25 = over25/sims;
  const pUnder25 = 1 - pOver25;
  const pBTTS = btts/sims;
  const meanGoals = sumGoals/sims;

  const ah = deriveAHLean({ pHome, gdCount, sims });
  const corners = expectedCorners({ league, home, away, meanGoals });
  const cards = expectedCards({ league, home, away, meanGoals });

  return {
    leagueFactor,
    lambdaH, lambdaA,
    score: bestScore,
    pHome, pDraw, pAway,
    pOver25, pUnder25,
    pBTTS,
    meanGoals,
    ah,
    corners,
    cards,
  };
}

/* ---------- AH ---------- */
function probCoverFromGD(gdCount, sims, line){
  const absFrac = Math.abs(line % 1);

  const pGDge = (k) => {
    let c = 0;
    for (const [gdStr, n] of gdCount.entries()){
      const gd = Number(gdStr);
      if (gd >= k) c += n;
    }
    return c / sims;
  };

  // quarter lines
  if (absFrac === 0.25 || absFrac === 0.75){
    const half = (line > 0) ? (Math.floor(line*2)/2) : (Math.ceil(line*2)/2);
    const integer = (line > 0) ? Math.floor(line) : Math.ceil(line);
    return 0.5*(probCoverFromGD(gdCount, sims, half) + probCoverFromGD(gdCount, sims, integer));
  }

  // integer (push half win)
  if (Number.isInteger(line)){
    const needWin = -line + 1;
    const pWin = pGDge(needWin);
    const pushGD = -line;
    const pushN = gdCount.get(pushGD) || 0;
    const pPush = pushN / sims;
    return pWin + 0.5*pPush;
  }

  // half line
  const needExact = (line === -0.5) ? 1 : (line === 0.5) ? 0 : (1 - line);
  const k = Math.ceil(needExact - 1e-9);
  return pGDge(k);
}

function deriveAHLean({ pHome, gdCount, sims }){
  let line;
  if (pHome >= 0.62) line = -0.75;
  else if (pHome >= 0.57) line = -0.5;
  else if (pHome >= 0.52) line = -0.25;
  else if (pHome >= 0.48) line = 0.0;
  else if (pHome >= 0.43) line = +0.25;
  else if (pHome >= 0.38) line = +0.5;
  else line = +0.75;

  const cover = probCoverFromGD(gdCount, sims, line);
  return { line, cover };
}

/* ---------- Corners/Cards ---------- */
function expectedCorners({ league, home, away, meanGoals }){
  const hp = teamParams(league, home);
  const ap = teamParams(league, away);

  if (hp?.corners_for != null && ap?.corners_for != null){
    const h = 0.55*hp.corners_for + 0.45*(ap.corners_against ?? ap.corners_for);
    const a = 0.55*ap.corners_for + 0.45*(hp.corners_against ?? hp.corners_for);
    return clamp(h+a, 6.0, 13.5);
  }

  const base = 9.4;
  const bump = (meanGoals - 2.6) * 0.9;
  return clamp(base + bump, 6.5, 13.8);
}

function expectedCards({ league, home, away, meanGoals }){
  const hp = teamParams(league, home);
  const ap = teamParams(league, away);

  if (hp?.cards_for != null && ap?.cards_for != null){
    const h = 0.55*hp.cards_for + 0.45*(ap.cards_against ?? ap.cards_for);
    const a = 0.55*ap.cards_for + 0.45*(hp.cards_against ?? hp.cards_for);
    return clamp(h+a, 2.2, 7.2);
  }

  const base = 4.1;
  const adj = (2.6 - meanGoals) * 0.35;
  return clamp(base + adj, 2.3, 7.0);
}

/* ---------- EV ---------- */
function evFromOdds(modelProb, decimalOdds){
  const o = safeNum(decimalOdds, null);
  if (!o || o <= 1.01) return null;
  const implied = 1 / o;
  const edge = modelProb - implied;
  return { implied, edge };
}

function evBestMarket(fx, model){
  const odds = fx?.odds || {};
  const cands = [];

  const add = (label, p, odd) => {
    const r = evFromOdds(p, odd);
    if (!r) return;
    cands.push({ label, ...r });
  };

  add("Home ML", model.pHome, odds.home);
  add("Draw", model.pDraw, odds.draw);
  add("Away ML", model.pAway, odds.away);
  add("Over2.5", model.pOver25, odds.over25);
  add("Under2.5", model.pUnder25, odds.under25);
  add("BTTS Yes", model.pBTTS, odds.bttsYes);
  add("BTTS No", 1-model.pBTTS, odds.bttsNo);

  if (!cands.length) return { tag:"NEUTRAL", bestLabel:"—", edge:0 };

  cands.sort((a,b)=>b.edge - a.edge);
  const best = cands[0];

  let tag = "NEUTRAL";
  if (best.edge >= 0.03) tag = "+EV";
  else if (best.edge <= -0.03) tag = "-EV";

  return { tag, bestLabel: best.label, edge: best.edge };
}

/* ---------- Pro Grade ---------- */
function proGrade({ pHome, pDraw, pAway, pOver25, pBTTS, cover, evTag }){
  const maxSide = Math.max(pHome, pDraw, pAway);
  const totalSignal = Math.max(pOver25, 1-pOver25);
  const bttsSignal = Math.max(pBTTS, 1-pBTTS);

  if (evTag === "+EV") return "A";
  if (maxSide >= 0.62 || cover >= 0.62) return "A";
  if (maxSide >= 0.55 || cover >= 0.56 || totalSignal >= 0.70 || bttsSignal >= 0.68) return "B";
  return "C";
}

/* ---------- UI helpers ---------- */
function pct(x){ return `${Math.round(x*100)}%`; }
function formatAH(line){
  const sign = line > 0 ? "+" : "";
  if (line === 0) return "0.0";
  return `${sign}${line.toFixed(2).replace(/\.00$/,".0").replace(/0$/,"")}`;
}

function ensureOption(select, value, label){
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

/* ---------- UI fill ---------- */
function fillLeagueSelect(){
  const sel = $("selectLeague");
  sel.innerHTML = "";
  state.leagues.forEach(l => ensureOption(sel, l, l));
  if (!state.league) state.league = state.leagues[0] || null;
  if (state.league) sel.value = state.league;
}

function fillTeams(){
  const homeSel = $("selectHome");
  const awaySel = $("selectAway");
  homeSel.innerHTML = "";
  awaySel.innerHTML = "";
  const teams = getLeagueTeams(state.league);
  teams.forEach(t => {
    ensureOption(homeSel, t, t);
    ensureOption(awaySel, t, t);
  });

  if (teams.includes("Arsenal")) homeSel.value = "Arsenal";
  if (teams.includes("Bournemouth")) awaySel.value = "Bournemouth";
  if (awaySel.value === homeSel.value && teams.length>1) awaySel.value = teams[1];
}

function getFixtures(league){
  return state.fixturesByLeague?.[league] || [];
}

function fillFixturesSelect(){
  const sel = $("selectFixture");
  sel.innerHTML = "";
  ensureOption(sel, "", "Select a fixture…");

  const fxs = getFixtures(state.league);
  state.fixtureList = fxs;

  fxs.forEach((fx, i) => {
    const date = fx.date ? ` • ${fx.date}` : "";
    ensureOption(sel, String(i), `${fx.home} vs ${fx.away}${date}`);
  });

  sel.value = "";
}

/* ---------- Output render ---------- */
function renderOutput({ league, home, away, model, fxMaybe }){
  const out = $("output");

  const ev = fxMaybe ? evBestMarket(fxMaybe, model) : { tag:"NEUTRAL", bestLabel:"—", edge:0 };
  const grade = proGrade({
    pHome:model.pHome, pDraw:model.pDraw, pAway:model.pAway,
    pOver25:model.pOver25, pBTTS:model.pBTTS,
    cover:model.ah.cover,
    evTag: ev.tag
  });

  const evBadgeClass = ev.tag === "+EV" ? "evP" : ev.tag === "-EV" ? "evM" : "evN";

  out.innerHTML = `
    <div class="k">Model</div>
    <div class="big">${home} vs ${away}
      <span class="muted" style="font-size:14px;font-weight:600">
        • League factor ${model.leagueFactor.toFixed(2)} • λ ${model.lambdaH.toFixed(2)} / ${model.lambdaA.toFixed(2)}
      </span>
    </div>

    <div class="chips">
      <span class="chip good">Pred: <b>${model.score}</b></span>
      <span class="chip">1X2: H ${pct(model.pHome)} • D ${pct(model.pDraw)} • A ${pct(model.pAway)}</span>
      <span class="chip warn">O/U 2.5: Over ${pct(model.pOver25)} • Under ${pct(model.pUnder25)}</span>
      <span class="chip">BTTS Yes: ${pct(model.pBTTS)}</span>
      <span class="chip">AH lean: Home ${formatAH(model.ah.line)} (${pct(model.ah.cover)} cover)</span>
      <span class="chip">Corners: ${model.corners.toFixed(1)}</span>
      <span class="chip">Cards: ${model.cards.toFixed(1)}</span>
      <span class="chip">Mean goals: ${model.meanGoals.toFixed(2)}</span>

      <span class="chip badge ${evBadgeClass}">EV: ${ev.tag}</span>
      <span class="chip">Best: <b>${ev.bestLabel}</b> ${ev.tag !== "NEUTRAL" ? `(${(ev.edge*100).toFixed(1)}% edge)` : ""}</span>
      <span class="chip badge ${grade}">Pro grade: ${grade}</span>
    </div>
  `;
}

/* ---------- Fixtures table ---------- */
function buildFixturesTable(){
  const host = $("fixturesTable");
  const fxs = getFixtures(state.league);

  if (!fxs.length){
    host.innerHTML = `<div class="muted">No fixtures for this league.</div>`;
    return;
  }

  const sims = clamp(safeNum($("inputSims").value, 10000), 3000, 20000);
  const simsTable = Math.min(6000, sims);
  const homeAdv = clamp(safeNum($("inputHomeAdv").value, 1.10), 1.02, 1.25);
  const baseGoals = clamp(safeNum($("inputBaseGoals").value, 1.35), 1.05, 1.75);
  const maxGoals = clamp(safeNum($("inputMaxGoals").value, 8), 6, 12);

  let html = `
    <table>
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Match</th>
          <th>Pred</th>
          <th>1X2</th>
          <th>O/U 2.5</th>
          <th>BTTS</th>
          <th>AH</th>
          <th>Corners</th>
          <th>Cards</th>
          <th>EV</th>
          <th>Pro</th>
        </tr>
      </thead>
      <tbody>
  `;

  fxs.forEach((fx, idx) => {
    const hp = teamParams(state.league, fx.home);
    const ap = teamParams(state.league, fx.away);

    if (!hp || !ap){
      html += `
        <tr>
          <td class="muted">${idx+1}</td>
          <td><b>${fx.home} vs ${fx.away}</b><div class="muted">${state.league}${fx.date ? " • "+fx.date : ""}</div></td>
          <td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>
          <td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>
        </tr>
      `;
      return;
    }

    const model = simulateMatch({
      league: state.league, home: fx.home, away: fx.away,
      sims: simsTable, homeAdv, baseGoals, maxGoals
    });

    const ev = evBestMarket(fx, model);
    const grade = proGrade({
      pHome:model.pHome, pDraw:model.pDraw, pAway:model.pAway,
      pOver25:model.pOver25, pBTTS:model.pBTTS,
      cover:model.ah.cover,
      evTag: ev.tag
    });

    const evBadgeClass = ev.tag === "+EV" ? "evP" : ev.tag === "-EV" ? "evM" : "evN";

    html += `
      <tr class="clickRow" data-fixture-index="${idx}">
        <td class="muted">${idx+1}</td>
        <td>
          <b>${fx.home} vs ${fx.away}</b>
          <div class="muted">${state.league}${fx.date ? " • "+fx.date : ""} • λ ${model.lambdaH.toFixed(2)} / ${model.lambdaA.toFixed(2)}</div>
        </td>
        <td><b>${model.score}</b></td>
        <td>H ${pct(model.pHome)} • D ${pct(model.pDraw)} • A ${pct(model.pAway)}</td>
        <td>O ${pct(model.pOver25)} • U ${pct(model.pUnder25)}</td>
        <td>${pct(model.pBTTS)}</td>
        <td>H ${formatAH(model.ah.line)}<div class="muted">${pct(model.ah.cover)} cover</div></td>
        <td>${model.corners.toFixed(1)}</td>
        <td>${model.cards.toFixed(1)}</td>
        <td>
          <span class="badge ${evBadgeClass}">${ev.tag}</span>
          <div class="muted" style="margin-top:4px">${ev.bestLabel}</div>
        </td>
        <td><span class="badge ${grade}">${grade}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  host.innerHTML = html;

  host.querySelectorAll("tr[data-fixture-index]").forEach(tr => {
    tr.addEventListener("click", () => {
      const i = Number(tr.getAttribute("data-fixture-index"));
      const fx = state.fixtureList[i];
      if (!fx) return;
      $("selectHome").value = fx.home;
      $("selectAway").value = fx.away;
      $("selectFixture").value = String(i);
      runPrediction();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ---------- Run prediction ---------- */
function runPrediction(){
  const league = $("selectLeague").value;
  const home = $("selectHome").value;
  const away = $("selectAway").value;

  const sims = clamp(safeNum($("inputSims").value, 10000), 3000, 30000);
  const homeAdv = clamp(safeNum($("inputHomeAdv").value, 1.10), 1.02, 1.25);
  const baseGoals = clamp(safeNum($("inputBaseGoals").value, 1.35), 1.05, 1.75);
  const maxGoals = clamp(safeNum($("inputMaxGoals").value, 8), 6, 12);

  if (!league || !home || !away || home === away){
    $("output").innerHTML = `<div class="k">Output</div><div class="muted">Pick league + two different teams.</div>`;
    return;
  }

  // if fixture selected, use its odds for EV display
  let fxMaybe = null;
  const v = $("selectFixture").value;
  if (v !== ""){
    const i = Number(v);
    fxMaybe = state.fixtureList[i] || null;
  }

  try{
    const model = simulateMatch({ league, home, away, sims, homeAdv, baseGoals, maxGoals });
    renderOutput({ league, home, away, model, fxMaybe });
  }catch(err){
    $("output").innerHTML = `<div class="k">Error</div><div class="muted">${String(err.message || err)}</div>`;
  }
}

/* ---------- Wire UI ---------- */
function wireUI(){
  $("selectLeague").addEventListener("change", () => {
    state.league = $("selectLeague").value;
    fillFixturesSelect();
    fillTeams();
    buildFixturesTable();
  });

  $("selectFixture").addEventListener("change", () => {
    const v = $("selectFixture").value;
    if (v === "") return;
    const i = Number(v);
    const fx = state.fixtureList[i];
    if (!fx) return;
    $("selectHome").value = fx.home;
    $("selectAway").value = fx.away;
  });

  $("btnRun").addEventListener("click", () => runPrediction());

  ["inputSims","inputHomeAdv","inputBaseGoals","inputMaxGoals"].forEach(id=>{
    $(id).addEventListener("change", () => buildFixturesTable());
  });
}

/* ---------- Init ---------- */
async function init(){
  try{
    state.xg = await loadJSON("xg_tables.json");
    setStatus("dotXg","statusXg",true,`xG loaded (${countTeams(state.xg)} teams)`);
  }catch(e){
    setStatus("dotXg","statusXg",false,`xG failed`);
    console.error(e);
  }

  try{
    state.fixturesRaw = await loadJSON("fixtures.json");
    state.fixturesByLeague = normalizeFixtures(state.fixturesRaw);
    setStatus("dotFix","statusFix",true,`fixtures loaded (${countFixturesMap(state.fixturesByLeague)})`);
  }catch(e){
    setStatus("dotFix","statusFix",false,`fixtures failed`);
    console.error(e);
  }

  try{
    state.h2h = await loadJSON("h2h.json");
    setStatus("dotH2h","statusH2h",true,`H2H loaded`);
  }catch(e){
    setStatus("dotH2h","statusH2h",false,`H2H missing (ok)`);
    console.warn(e);
  }

  state.leagues = leaguesFromData();
  if (!state.leagues.length){
    $("output").innerHTML = `<div class="k">Error</div><div class="muted">No leagues found. Check JSON files exist in repo root.</div>`;
    return;
  }

  state.league = state.leagues[0];

  fillLeagueSelect();
  fillFixturesSelect();
  fillTeams();
  wireUI();
  buildFixturesTable();
}

function countTeams(xg){
  if (!xg) return 0;
  let n = 0;
  for (const lg of Object.keys(xg)){
    n += Object.keys(xg[lg] || {}).length;
  }
  return n;
}

init();
