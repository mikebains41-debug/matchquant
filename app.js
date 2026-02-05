// MatchQuant (simple, reliable loader for GitHub Pages subpaths)

const leagueEl = document.getElementById("league");
const statusEl = document.getElementById("leagueStatus");
const homeEl = document.getElementById("homeTeam");
const awayEl = document.getElementById("awayTeam");
const runBtn = document.getElementById("runBtn");

const resultBox = document.getElementById("resultBox");
const rLeague = document.getElementById("rLeague");
const rMatch = document.getElementById("rMatch");
const rXg = document.getElementById("rXg");
const rScore = document.getElementById("rScore");
const rWdl = document.getElementById("rWdl");

let xgTables = {}; // { leagueName: { teams: {TeamName:{att,def}}, leagueAvg... } } or whatever your file contains

function setStatus(msg, ok=true){
  statusEl.innerHTML = ok ? `<span class="ok">✔ ${msg}</span>` : `<span class="bad">✖ ${msg}</span>`;
}

async function fetchJsonSmart(filename){
  // Works on both:
  // https://user.github.io/repo/  and local file servers
  const urls = [
    `./${filename}`,
    `${filename}`,
  ];

  let lastErr = null;
  for (const u of urls){
    try{
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) throw new Error(`${u} -> HTTP ${res.status}`);
      return await res.json();
    } catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function fillLeagueDropdown(leagueNames){
  leagueEl.innerHTML = `<option value="">Select a league…</option>` +
    leagueNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function poissonPmf(k, lambda){
  // simple PMF
  let p = Math.exp(-lambda);
  for (let i=1;i<=k;i++) p *= lambda/i;
  return p;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function simulateWDL(lambdaH, lambdaA){
  // quick approximate via score grid 0..6
  let win=0, draw=0, lose=0;
  for (let h=0; h<=6; h++){
    const ph = poissonPmf(h, lambdaH);
    for (let a=0; a<=6; a++){
      const pa = poissonPmf(a, lambdaA);
      const p = ph*pa;
      if (h>a) win += p;
      else if (h===a) draw += p;
      else lose += p;
    }
  }
  const sum = win+draw+lose;
  if (sum > 0){
    win/=sum; draw/=sum; lose/=sum;
  }
  return { win, draw, lose };
}

function pickScoreline(lambdaH, lambdaA){
  // most likely score 0..5
  let best = {h:0,a:0,p:-1};
  for (let h=0; h<=5; h++){
    const ph = poissonPmf(h, lambdaH);
    for (let a=0; a<=5; a++){
      const pa = poissonPmf(a, lambdaA);
      const p = ph*pa;
      if (p > best.p) best = {h,a,p};
    }
  }
  return best;
}

function getTeamEntry(leagueObj, teamName){
  // support multiple possible structures
  // If your xg_tables.json is different, this still safely fails with a clear message.
  if (!leagueObj) return null;

  if (leagueObj.teams && leagueObj.teams[teamName]) return leagueObj.teams[teamName];
  if (leagueObj[teamName]) return leagueObj[teamName];

  return null;
}

function computeLambdas(leagueObj, homeTeam, awayTeam){
  const h = getTeamEntry(leagueObj, homeTeam);
  const a = getTeamEntry(leagueObj, awayTeam);

  if (!h) throw new Error(`Home team not found in table: "${homeTeam}"`);
  if (!a) throw new Error(`Away team not found in table: "${awayTeam}"`);

  // Try common fields: att/def, xG/xGA, attack/defense
  const hAtt = h.att ?? h.attack ?? h.xg ?? h.xG ?? h.xGF;
  const hDef = h.def ?? h.defense ?? h.xga ?? h.xGA ?? h.xGAconceded;
  const aAtt = a.att ?? a.attack ?? a.xg ?? a.xG ?? a.xGF;
  const aDef = a.def ?? a.defense ?? a.xga ?? a.xGA ?? a.xGAconceded;

  if (hAtt == null || hDef == null || aAtt == null || aDef == null){
    throw new Error("Your xg_tables.json team entries don’t have expected fields (att/def or xg/xga).");
  }

  // Simple lambda model:
  // λ_home = (home attack + away defense) / 2
  // λ_away = (away attack + home defense) / 2
  const lambdaH = Math.max(0.05, (Number(hAtt) + Number(aDef)) / 2);
  const lambdaA = Math.max(0.05, (Number(aAtt) + Number(hDef)) / 2);

  return { lambdaH, lambdaA };
}

async function init(){
  try{
    xgTables = await fetchJsonSmart("xg_tables.json");

    const leagueNames = Object.keys(xgTables);
    if (!leagueNames.length){
      throw new Error("xg_tables.json loaded but has no leagues at top level.");
    }

    fillLeagueDropdown(leagueNames);
    setStatus(`xG loaded (${leagueNames.length} leagues)`);

    // Make sure the dropdown is clickable on mobile
    leagueEl.disabled = false;
    leagueEl.style.pointerEvents = "auto";
  } catch(e){
    console.error(e);
    leagueEl.innerHTML = `<option value="">(Failed to load leagues)</option>`;
    setStatus(`Could not load xg_tables.json. Check file is in repo root. (${e.message})`, false);
  }
}

runBtn.addEventListener("click", () => {
  try{
    const league = leagueEl.value;
    if (!league) throw new Error("Pick a league first.");

    const home = homeEl.value.trim();
    const away = awayEl.value.trim();
    if (!home || !away) throw new Error("Type both team names.");

    const leagueObj = xgTables[league];
    const { lambdaH, lambdaA } = computeLambdas(leagueObj, home, away);

    const sc = pickScoreline(lambdaH, lambdaA);
    const wdl = simulateWDL(lambdaH, lambdaA);

    resultBox.style.display = "block";
    rLeague.textContent = league;
    rMatch.textContent = `${home} vs ${away}`;
    rXg.textContent = `Home λ ${lambdaH.toFixed(2)} / Away λ ${lambdaA.toFixed(2)}`;
    rScore.textContent = `${sc.h}-${sc.a}`;
    rWdl.textContent = `${Math.round(wdl.win*100)}% / ${Math.round(wdl.draw*100)}% / ${Math.round(wdl.lose*100)}%`;
  } catch(e){
    alert(e.message);
  }
});

init();
