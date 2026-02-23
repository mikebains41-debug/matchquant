const $ = (id) => document.getElementById(id);

const state = {
  tables: { leagues:{}, teams:{}, xg:{}, h2h:{} },
  deferredPrompt: null,
};

const STORAGE_KEY = "mq2_history_v1";

function setNetBadge(){
  const b = $("netBadge");
  const on = navigator.onLine;
  b.textContent = on ? "Online" : "Offline";
  b.style.borderColor = on ? "rgba(61,220,151,.35)" : "rgba(255,255,255,.12)";
  b.style.color = on ? "rgba(61,220,151,.95)" : "rgba(174,185,214,.95)";
}

async function loadJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed ${path}: ${res.status}`);
  return await res.json();
}

function fillSelect(selectEl, items, placeholder){
  selectEl.innerHTML = "";
  const p = document.createElement("option");
  p.value = "";
  p.textContent = placeholder;
  p.disabled = true;
  p.selected = true;
  selectEl.appendChild(p);

  for (const it of items){
    const o = document.createElement("option");
    o.value = it;
    o.textContent = it;
    selectEl.appendChild(o);
  }
}

function leagueTeams(league){
  const t = state.tables.teams?.[league] || {};
  return Object.keys(t).sort((a,b)=>a.localeCompare(b));
}

function round2(x){ return Math.round(x*100)/100; }
function pct(x){
  if (x==null || isNaN(x)) return "—";
  return `${Math.round(x*1000)/10}%`;
}

function renderOutput(result){
  if (result.error){
    $("output").innerHTML = `<div class="muted">${result.error}</div>`;
    return;
  }

  const { inputs, model, market, edges, fairOdds } = result;

  const best = model.bestScore;
  const bestStr = `${best.h}-${best.a} (${pct(best.p)})`;

  const edgeLine = market ? `
    <div class="hr"></div>
    <div class="small"><b>Market comparison (no-vig from your 1X2 odds)</b></div>
    <div class="code">
      Market: H ${pct(market.noVig.pH)} / D ${pct(market.noVig.pD)} / A ${pct(market.noVig.pA)}<br/>
      Edge:   H ${edges.home>=0?"+":""}${pct(edges.home)} / D ${edges.draw>=0?"+":""}${pct(edges.draw)} / A ${edges.away>=0?"+":""}${pct(edges.away)}
    </div>
  ` : "";

  const ouLine = inputs.ouLine;
  const ahLine = inputs.ahLine;

  const ouBlock = (ouLine!=null && !isNaN(ouLine)) ? `
    <div class="kpi">
      <div class="label">Over ${ouLine}</div>
      <div class="value">${pct(model.pOver)}</div>
      <div class="small">Fair odds: ${fairOdds.over ? round2(fairOdds.over) : "—"}</div>
    </div>
    <div class="kpi">
      <div class="label">Under ${ouLine}</div>
      <div class="value">${pct(model.pUnder)}</div>
      <div class="small">Fair odds: ${fairOdds.under ? round2(fairOdds.under) : "—"}</div>
    </div>
  ` : `
    <div class="kpi">
      <div class="label">O/U</div>
      <div class="value">—</div>
      <div class="small">Enter a line to compute</div>
    </div>
    <div class="kpi">
      <div class="label">O/U</div>
      <div class="value">—</div>
      <div class="small">Enter a line to compute</div>
    </div>
  `;

  const ahBlock = (ahLine!=null && !isNaN(ahLine)) ? `
    <div class="kpi">
      <div class="label">Home AH ${ahLine}</div>
      <div class="value">${pct(model.pAHHome)}</div>
      <div class="small">Win-prob only (push separate)</div>
    </div>
    <div class="kpi">
      <div class="label">Away AH ${-ahLine}</div>
      <div class="value">${pct(model.pAHAway)}</div>
      <div class="small">Win-prob only (push separate)</div>
    </div>
  ` : `
    <div class="kpi">
      <div class="label">AH</div>
      <div class="value">—</div>
      <div class="small">Enter a line to compute</div>
    </div>
    <div class="kpi">
      <div class="label">AH</div>
      <div class="value">—</div>
      <div class="small">Enter a line to compute</div>
    </div>
  `;

  // Quick “best angle” heuristic
  let angle = [];
  const probs = [
    {k:"Home", p:model.pHome, fo:fairOdds.home},
    {k:"Draw", p:model.pDraw, fo:fairOdds.draw},
    {k:"Away", p:model.pAway, fo:fairOdds.away},
  ].sort((a,b)=>b.p-a.p);

  angle.push(`Most likely result by model: <b>${probs[0].k}</b> (${pct(probs[0].p)})`);

  if (ouLine!=null && model.pOver!=null){
    angle.push(`Total lean: <b>${model.pOver>0.52 ? "Over" : (model.pOver<0.48 ? "Under" : "No strong edge")}</b>`);
  }
  if (ahLine!=null && model.pAHHome!=null){
    angle.push(`AH lean: <b>${model.pAHHome>0.52 ? "Home" : (model.pAHHome<0.48 ? "Away" : "No strong edge")}</b>`);
  }

  $("output").innerHTML = `
    <div><b>${inputs.homeTeam}</b> vs <b>${inputs.awayTeam}</b> • <span class="muted">${inputs.league}</span></div>

    <div class="kpis">
      <div class="kpi">
        <div class="label">Projected score</div>
        <div class="value">${round2(model.expHome)}–${round2(model.expAway)}</div>
        <div class="small">xG-ish λ: ${round2(inputs.lamH)} / ${round2(inputs.lamA)}</div>
      </div>

      <div class="kpi">
        <div class="label">Most likely score</div>
        <div class="value">${best.h}-${best.a}</div>
        <div class="small">${bestStr}</div>
      </div>

      <div class="kpi">
        <div class="label">Home / Draw / Away</div>
        <div class="value">${pct(model.pHome)} / ${pct(model.pDraw)} / ${pct(model.pAway)}</div>
        <div class="small">Fair: ${round2(fairOdds.home)} / ${round2(fairOdds.draw)} / ${round2(fairOdds.away)}</div>
      </div>

      <div class="kpi">
        <div class="label">Expected total</div>
        <div class="value">${round2(model.expTotal)}</div>
        <div class="small">Pace adj: ${round2(inputs.pace)}</div>
      </div>

      ${ouBlock}
      ${ahBlock}
    </div>

    <div class="hr"></div>
    <div class="small"><b>Quick read</b></div>
    <div class="code">${angle.join("<br/>")}</div>

    ${edgeLine}
  `;
}

function getHistory(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }catch{
    return [];
  }
}

function setHistory(items){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderHistory();
}

function renderHistory(){
  const items = getHistory();
  if (!items.length){
    $("history").innerHTML = `<div class="muted">No saved matches yet.</div>`;
    return;
  }
  $("history").innerHTML = items.slice().reverse().map(it => `
    <div class="item">
      <div class="top">
        <div class="match">${it.home} vs ${it.away} • ${it.league}</div>
        <div class="meta">${new Date(it.ts).toLocaleString()}</div>
      </div>
      <div class="meta">Score: ${it.expHome.toFixed(2)}–${it.expAway.toFixed(2)} • 1X2: ${Math.round(it.pH*100)} / ${Math.round(it.pD*100)} / ${Math.round(it.pA*100)}</div>
    </div>
  `).join("");
}

function currentOptions(){
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ouLine: toNum($("ouLine").value),
    ahLine: toNum($("ahLine").value),
    oddsH: toNum($("oddsH").value),
    oddsD: toNum($("oddsD").value),
    oddsA: toNum($("oddsA").value),
  };
}

function getSelection(){
  return {
    league: $("leagueSelect").value,
    homeTeam: $("homeSelect").value,
    awayTeam: $("awaySelect").value,
    date: $("matchDate").value || null
  };
}

function run(){
  const { league, homeTeam, awayTeam } = getSelection();
  const result = window.MQ2.analyzeMatch({
    league,
    homeTeam,
    awayTeam,
    tables: {
      leagues: state.tables.leagues,
      teams: state.tables.teams,
      xg: state.tables.xg,
      h2h: state.tables.h2h
    },
    options: currentOptions()
  });
  state.lastResult = result;
  renderOutput(result);
}

function saveToHistory(){
  const r = state.lastResult;
  if (!r || r.error) return;

  const items = getHistory();
  items.push({
    ts: Date.now(),
    league: r.inputs.league,
    home: r.inputs.homeTeam,
    away: r.inputs.awayTeam,
    expHome: r.model.expHome,
    expAway: r.model.expAway,
    pH: r.model.pHome,
    pD: r.model.pDraw,
    pA: r.model.pAway
  });
  setHistory(items);
}

function resetAll(){
  $("ouLine").value = "";
  $("ahLine").value = "";
  $("oddsH").value = "";
  $("oddsD").value = "";
  $("oddsA").value = "";
  $("matchDate").value = "";
  $("output").innerHTML = `<div class="muted">Pick a league + teams and hit <b>Run Prediction</b>.</div>`;
}

async function init(){
  setNetBadge();
  window.addEventListener("online", setNetBadge);
  window.addEventListener("offline", setNetBadge);

  // Load data
  const [leagues, teams, xg, h2h] = await Promise.all([
    loadJSON("data/leagues.json"),
    loadJSON("data/teams.json"),
    loadJSON("data/xg_tables.json"),
    loadJSON("data/h2h.json"),
  ]);

  state.tables.leagues = leagues;
  state.tables.teams = teams;
  state.tables.xg = xg;
  state.tables.h2h = h2h;

  const leagueNames = Object.keys(leagues).sort((a,b)=>a.localeCompare(b));
  fillSelect($("leagueSelect"), leagueNames, "Select league");

  $("leagueSelect").addEventListener("change", () => {
    const league = $("leagueSelect").value;
    const teams = leagueTeams(league);
    fillSelect($("homeSelect"), teams, "Select home team");
    fillSelect($("awaySelect"), teams, "Select away team");
  });

  $("runBtn").addEventListener("click", run);
  $("saveBtn").addEventListener("click", saveToHistory);
  $("swapBtn").addEventListener("click", () => {
    const h = $("homeSelect").value;
    const a = $("awaySelect").value;
    if (!h || !a) return;
    $("homeSelect").value = a;
    $("awaySelect").value = h;
  });
  $("resetBtn").addEventListener("click", resetAll);

  $("exportBtn").addEventListener("click", () => {
    const items = getHistory();
    const blob = new Blob([JSON.stringify(items, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mq2_history.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("clearHistoryBtn").addEventListener("click", () => setHistory([]));
  renderHistory();

  // Service worker
  if ("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("sw.js");
    }catch(e){
      console.warn("SW register failed", e);
    }
  }

  // Install prompt
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    $("installBtn").style.display = "inline-block";
  });

  $("installBtn").addEventListener("click", async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    $("installBtn").style.display = "none";
  });

  // Auto-select first league for convenience
  if (leagueNames.length){
    $("leagueSelect").value = leagueNames[0];
    $("leagueSelect").dispatchEvent(new Event("change"));
    const t = leagueTeams(leagueNames[0]);
    if (t.length >= 2){
      $("homeSelect").value = t[0];
      $("awaySelect").value = t[1];
    }
  }
}

init().catch(err => {
  $("output").innerHTML = `<div class="muted">Startup error: ${String(err)}</div>`;
});
