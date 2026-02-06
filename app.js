/* MatchQuant App (UI + data loading)
   Loads:
   - fixtures.json (required)
   - h2h.json (optional)
   - data/xg_2025_2026.json (optional)
*/

const state = {
  fixtures: null,
  h2h: null,
  xg: null,
  leagues: [],
  leagueTeams: {},
  leagueFixtures: {},
  leagueFactor: {}, // default 1.0 per league
  xgLeagueAvg: {}   // computed
};

function $(id){ return document.getElementById(id); }

function setStatus(msg){
  $("status").textContent = msg;
}

function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return await res.json();
}

async function tryFetchJson(url){
  try{
    return await fetchJson(url);
  }catch(e){
    return null;
  }
}

function uniq(arr){
  return [...new Set(arr)];
}

function pct(x){
  return (x*100).toFixed(1) + "%";
}

function fmtEdge(edge){
  if (!edge || !Number.isFinite(edge)) return "0";
  return (edge*100).toFixed(1) + "pp";
}

function buildFromFixtures(fixtures){
  // Expected fixtures.json formats supported:
  // A) { "Premier League": [ {home:"Arsenal", away:"Brighton", date:"..."}, ...], ...}
  // B) [ {league:"Premier League", home:"...", away:"..."} ... ]
  const leagueFixtures = {};
  const leagueTeams = {};

  if (Array.isArray(fixtures)){
    for (const f of fixtures){
      const L = f.league || "Unknown";
      leagueFixtures[L] ||= [];
      leagueFixtures[L].push(f);
      leagueTeams[L] ||= [];
      if (f.home) leagueTeams[L].push(f.home);
      if (f.away) leagueTeams[L].push(f.away);
    }
  } else {
    for (const L of Object.keys(fixtures)){
      const arr = fixtures[L] || [];
      leagueFixtures[L] = arr;
      leagueTeams[L] = [];
      for (const f of arr){
        if (f.home) leagueTeams[L].push(f.home);
        if (f.away) leagueTeams[L].push(f.away);
      }
    }
  }

  for (const L of Object.keys(leagueTeams)){
    leagueTeams[L] = uniq(leagueTeams[L]).sort();
  }

  return { leagueFixtures, leagueTeams };
}

function populateSelect(selectEl, options, placeholder=null){
  selectEl.innerHTML = "";
  if (placeholder){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    selectEl.appendChild(opt);
  }
  for (const o of options){
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    selectEl.appendChild(opt);
  }
}

function leagueAvgXG(leagueName){
  // compute average xG in that league if xg data exists
  const pack = state.xg?.[leagueName];
  if (!pack) return null;
  const teams = Object.values(pack);
  const xs = teams.map(t => safeNum(t.xg)).filter(x => x != null);
  if (xs.length < 4) return null;
  const avg = xs.reduce((a,b)=>a+b,0) / xs.length;
  return avg;
}

function getXGPack(league, home, away){
  if (!state.xg || !state.xg[league]) return null;
  const L = state.xg[league];
  const homeObj = L[home];
  const awayObj = L[away];
  if (!homeObj && !awayObj) return null;

  const avg = state.xgLeagueAvg[league] || leagueAvgXG(league);
  if (!avg) return null;

  return {
    homeXG: safeNum(homeObj?.xg),
    awayXG: safeNum(awayObj?.xg),
    leagueAvgXG: avg
  };
}

function renderResult(pred){
  const { league, home, away } = pred;
  const p = pred.probs;
  const b = pred.bestScore;
  const m = pred.means;
  const top5 = pred.top5;

  const ahLine = $("ahLine").value;
  const ahSide = $("ahSide").value;

  let ahHtml = "";
  if (pred.ah && ahLine !== ""){
    ahHtml = `
      <div class="sp"></div>
      <h3 style="margin:12px 0 6px">Asian Handicap</h3>
      <div style="color:var(--muted); font-size:13px;">
        (${ahSide} ${ahLine}) cover: <b>${pct(pred.ah.cover)}</b> · push: <b>${pct(pred.ah.push)}</b>
      </div>
    `;
  }

  const ev = pred.ev;
  const evHtml = `
    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">Odds EV check <span style="color:var(--muted); font-weight:500;">(based on odds you entered)</span></h3>
    <div style="color:var(--muted); font-size:13px; line-height:1.6;">
      ${home} ML: <b>${fmtEdge(ev.homeML)}</b><br/>
      Draw: <b>${fmtEdge(ev.draw)}</b><br/>
      ${away} ML: <b>${fmtEdge(ev.awayML)}</b><br/>
      Over 2.5: <b>${fmtEdge(ev.over25)}</b><br/>
      Under 2.5: <b>${fmtEdge(ev.under25)}</b><br/>
      BTTS Yes: <b>${fmtEdge(ev.bttsYes)}</b><br/>
      BTTS No: <b>${fmtEdge(ev.bttsNo)}</b>
    </div>
  `;

  const top5Lines = top5.map(s => `${s.i}-${s.j} (${pct(s.p)})`).join("<br/>");

  const xgPack = getXGPack(league, home, away);
  const xgLine = xgPack
    ? `<div style="color:var(--muted); font-size:13px; margin-top:6px;">
         xG adj: ${home} xG ${xgPack.homeXG ?? "—"} · ${away} xG ${xgPack.awayXG ?? "—"} · league avg ${xgPack.leagueAvgXG.toFixed(2)}
       </div>`
    : `<div style="color:var(--muted); font-size:13px; margin-top:6px;">
         xG: not loaded (optional)
       </div>`;

  $("results").innerHTML = `
    <div style="font-size:18px; font-weight:800; margin-bottom:4px;">${home} vs ${away}</div>
    <div style="color:var(--muted); margin-bottom:12px;">${league} · league_factor ${(state.leagueFactor[league] ?? 1.0).toFixed(2)}</div>

    <h3 style="margin:0 0 6px">Win Probabilities</h3>
    <div style="font-size:16px; line-height:1.6;">
      ${home}: <b>${pct(p.home)}</b><br/>
      Draw: <b>${pct(p.draw)}</b><br/>
      ${away}: <b>${pct(p.away)}</b>
    </div>

    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">Most Likely Score</h3>
    <div style="font-size:18px; font-weight:800;">${b.home}-${b.away}</div>

    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">O/U 2.5</h3>
    <div style="font-size:16px; line-height:1.6;">
      Over 2.5: <b>${pct(p.over25)}</b><br/>
      Under 2.5: <b>${pct(p.under25)}</b>
    </div>

    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">BTTS</h3>
    <div style="font-size:16px;">BTTS (Yes): <b>${pct(p.bttsYes)}</b></div>

    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">Model means</h3>
    <div style="color:var(--muted); font-size:13px;">
      mu(home) ${m.home.toFixed(2)} · mu(away) ${m.away.toFixed(2)} · cap ${m.cap}
    </div>
    ${xgLine}

    <div class="sp"></div>
    <h3 style="margin:12px 0 6px">Top 5 scorelines</h3>
    <div style="font-size:15px; line-height:1.6;">${top5Lines}</div>

    ${ahHtml}
    ${evHtml}
  `;
}

function getSelectedTeams(){
  const home = $("homeTeam").value;
  const away = $("awayTeam").value;
  return {home, away};
}

function updateTeamsForLeague(){
  const L = $("league").value;
  const teams = state.leagueTeams[L] || [];
  populateSelect($("homeTeam"), teams);
  populateSelect($("awayTeam"), teams);

  // reasonable defaults
  if (teams.length >= 2){
    $("homeTeam").value = teams[0];
    $("awayTeam").value = teams[1];
  }
}

function updateFixturesForLeague(){
  const L = $("league").value;
  const arr = state.leagueFixtures[L] || [];
  const label = (f) => {
    const d = f.date ? ` · ${f.date}` : "";
    return `${f.home} vs ${f.away}${d}`;
  };

  const opts = arr.map((f, idx) => ({ idx, text: label(f) }));
  const fixtureSel = $("fixture");
  fixtureSel.innerHTML = `<option value="">Select Fixture (optional)</option>`;
  for (const o of opts){
    const opt = document.createElement("option");
    opt.value = String(o.idx);
    opt.textContent = o.text;
    fixtureSel.appendChild(opt);
  }
}

function onFixturePick(){
  const L = $("league").value;
  const idx = $("fixture").value;
  if (idx === "") return;
  const f = (state.leagueFixtures[L] || [])[Number(idx)];
  if (!f) return;

  if (f.home) $("homeTeam").value = f.home;
  if (f.away) $("awayTeam").value = f.away;
}

function readInputs(){
  const league = $("league").value;
  const {home, away} = getSelectedTeams();

  const baseGoals = safeNum($("baseGoals").value) ?? 1.35;
  const homeAdv = safeNum($("homeAdv").value) ?? 1.10;
  const goalCap = safeNum($("goalCap").value) ?? 8;

  const odds = {
    homeML: safeNum($("oddsHome").value),
    draw: safeNum($("oddsDraw").value),
    awayML: safeNum($("oddsAway").value),
    over25: safeNum($("oddsO25").value),
    under25: safeNum($("oddsU25").value),
    bttsYes: safeNum($("oddsBTTSY").value),
    bttsNo: safeNum($("oddsBTTSN").value),
  };

  const ahLineVal = $("ahLine").value;
  const ah = {
    side: $("ahSide").value,
    line: (ahLineVal === "") ? "" : Number(ahLineVal),
    odds: safeNum($("ahOdds").value)
  };

  return { league, home, away, baseGoals, homeAdv, goalCap, odds, ah };
}

function canRun({league, home, away}){
  if (!league) return "Pick a league.";
  if (!home || !away) return "Pick both teams.";
  if (home === away) return "Home and Away can’t be the same.";
  return null;
}

async function init(){
  $("runBtn").addEventListener("click", () => runPrediction());
  $("league").addEventListener("change", () => {
    updateTeamsForLeague();
    updateFixturesForLeague();
    $("fixture").value = "";
  });
  $("fixture").addEventListener("change", onFixturePick);

  // Load data
  setStatus("Loading data…");

  const fixtures = await fetchJson("fixtures.json?v=6");
  const h2h = await tryFetchJson("h2h.json?v=6");
  const xg = await tryFetchJson("data/xg_2025_2026.json?v=6"); // optional

  state.fixtures = fixtures;
  state.h2h = h2h;
  state.xg = xg;

  const built = buildFromFixtures(fixtures);
  state.leagueFixtures = built.leagueFixtures;
  state.leagueTeams = built.leagueTeams;
  state.leagues = Object.keys(state.leagueTeams).sort();

  // default league factors (keep simple for now)
  for (const L of state.leagues) state.leagueFactor[L] = 1.0;

  // compute xG league averages if file exists
  if (state.xg){
    for (const L of Object.keys(state.xg)){
      const avg = leagueAvgXG(L);
      if (avg) state.xgLeagueAvg[L] = avg;
    }
  }

  populateSelect($("league"), state.leagues);
  $("league").value = state.leagues[0] || "";
  updateTeamsForLeague();
  updateFixturesForLeague();

  const xgMsg = state.xg ? "xG loaded" : "xG not loaded (optional)";
  setStatus(`Loaded: ${state.leagues.length} leagues · fixtures OK · ${xgMsg}`);
}

function runPrediction(){
  const btn = $("runBtn");
  btn.disabled = true;

  try{
    const inp = readInputs();
    const err = canRun(inp);
    if (err){
      $("results").textContent = err;
      return;
    }

    const leagueFactor = state.leagueFactor[inp.league] ?? 1.0;
    const xgPack = getXGPack(inp.league, inp.home, inp.away);

    const pred = MQ.predict({
      league: inp.league,
      home: inp.home,
      away: inp.away,
      baseGoals: inp.baseGoals,
      homeAdv: inp.homeAdv,
      goalCap: inp.goalCap,
      leagueFactor,
      xgPack,
      odds: inp.odds,
      ah: inp.ah
    });

    renderResult(pred);
  } catch(e){
    $("results").textContent = "Error running prediction: " + (e?.message || String(e));
  } finally {
    btn.disabled = false;
  }
}

// PWA: optional service worker (if you add sw.js)
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}

init();
