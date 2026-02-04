// MatchQuant Engine (xG + Monte Carlo + EV + H2H + Auto fixtures)
// Works fully static on GitHub Pages.

const MC_SIMS = 10000;

let XG = null;      // xg_tables.json
let FIX = null;     // fixtures.json
let H2H = null;     // h2h.json

const els = {
  leagueSelect: document.getElementById("leagueSelect"),
  homeTeam: document.getElementById("homeTeam"),
  awayTeam: document.getElementById("awayTeam"),
  teamsList: document.getElementById("teamsList"),
  runBtn: document.getElementById("runBtn"),
  runAllBtn: document.getElementById("runAllBtn"),
  loadedLine: document.getElementById("loadedLine"),

  rLeague: document.getElementById("rLeague"),
  rMatch: document.getElementById("rMatch"),
  rXg: document.getElementById("rXg"),
  rScore: document.getElementById("rScore"),
  rO25: document.getElementById("rO25"),
  rAH: document.getElementById("rAH"),
  rHDA: document.getElementById("rHDA"),
  rEV: document.getElementById("rEV"),
  rConf: document.getElementById("rConf"),
  rTop: document.getElementById("rTop"),
  rH2H: document.getElementById("rH2H"),

  autoBody: document.getElementById("autoBody"),

  oddsHome: document.getElementById("oddsHome"),
  oddsDraw: document.getElementById("oddsDraw"),
  oddsAway: document.getElementById("oddsAway"),
  oddsO25Over: document.getElementById("oddsO25Over"),
  oddsO25Under: document.getElementById("oddsO25Under"),
  oddsAHHome05: document.getElementById("oddsAHHome05"),
  cornersLine: document.getElementById("cornersLine"),
  oddsCornersOver: document.getElementById("oddsCornersOver"),
  oddsCornersUnder: document.getElementById("oddsCornersUnder"),
  cardsLine: document.getElementById("cardsLine"),
  oddsCardsOver: document.getElementById("oddsCardsOver"),
  oddsCardsUnder: document.getElementById("oddsCardsUnder"),
};

function safeNum(v){
  const n = Number(String(v||"").trim());
  return Number.isFinite(n) ? n : null;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function normalizeTeam(s){
  return String(s||"").trim().toLowerCase();
}

function pickLeagueKeys(){
  // supports either {leagues:{...}} or {EPL:{...}, ...}
  if (!XG) return [];
  if (XG.leagues && typeof XG.leagues === "object") return Object.keys(XG.leagues);
  return Object.keys(XG);
}

function getLeagueObj(leagueKey){
  if (!XG) return null;
  if (XG.leagues) return XG.leagues[leagueKey] || null;
  return XG[leagueKey] || null;
}

function buildTeamsListForLeague(leagueKey){
  const L = getLeagueObj(leagueKey);
  if (!L) return [];
  const teams = Object.keys(L.teams || {});
  return teams.sort((a,b)=>a.localeCompare(b));
}

function updateDatalist(teams){
  els.teamsList.innerHTML = "";
  teams.forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t;
    els.teamsList.appendChild(opt);
  });
}

function poissonSample(lambda){
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function mcSim(homeLambda, awayLambda, n=MC_SIMS){
  let homeW=0, draw=0, awayW=0, over25=0;
  const scoreMap = new Map(); // "H-A" => count
  for(let i=0;i<n;i++){
    const hg = poissonSample(homeLambda);
    const ag = poissonSample(awayLambda);
    if (hg>ag) homeW++;
    else if (hg===ag) draw++;
    else awayW++;
    if ((hg+ag) >= 3) over25++;
    const key = `${hg}-${ag}`;
    scoreMap.set(key, (scoreMap.get(key)||0)+1);
  }
  const top = Array.from(scoreMap.entries())
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3)
    .map(([k,c])=>({score:k, p:c/n}));

  return {
    pHome: homeW/n,
    pDraw: draw/n,
    pAway: awayW/n,
    pO25: over25/n,
    top
  };
}

function expectedMostLikelyScoreFromPoisson(homeLambda, awayLambda){
  // simple mode approximation: round lambdas
  const hg = Math.max(0, Math.round(homeLambda));
  const ag = Math.max(0, Math.round(awayLambda));
  return `${hg}-${ag}`;
}

function ou25Label(pO25){
  return pO25 >= 0.52 ? `Over (${Math.round(pO25*100)}%)` : `Under (${Math.round((1-pO25)*100)}%)`;
}

function ahLean(pHome,pDraw,pAway){
  // Very simple: if home win > away win by margin, lean home -0.5, else DNB, else away +0.5 style
  if (pHome >= 0.52) return "Home -0.5";
  if (pAway >= 0.52) return "Away +0.5";
  return "0 (Draw No Bet lean)";
}

function confidenceTier(pMax){
  // Tiering based on the strongest edge probability
  if (pMax >= 0.62) return "Tier 1 (Strong)";
  if (pMax >= 0.56) return "Tier 2 (Solid)";
  if (pMax >= 0.50) return "Tier 3 (Lean)";
  return "Tier 4 (No edge)";
}

function evFlag(prob, odds){
  // EV = p*odds - 1 (decimal odds)
  if (!odds || odds <= 1.0) return null;
  const ev = prob * odds - 1;
  if (ev >= 0.05) return {flag:"Green", ev};
  if (ev >= -0.02) return {flag:"Yellow", ev};
  return {flag:"Red", ev};
}

function fmtPct(p){ return `${Math.round(p*100)}%`; }

function findH2H(leagueKey, home, away){
  if (!H2H) return null;
  const key1 = `${normalizeTeam(home)}__${normalizeTeam(away)}`;
  const key2 = `${normalizeTeam(away)}__${normalizeTeam(home)}`;
  const byLeague = H2H[leagueKey] || H2H[(leagueKey||"").toLowerCase()] || null;
  if (!byLeague) return null;
  return byLeague[key1] || byLeague[key2] || null;
}

function buildH2HString(h2hObj){
  if (!h2hObj) return "—";
  const s = h2hObj.score ?? "—";
  const c = h2hObj.corners ?? "—";
  const cards = h2hObj.cards ?? "—";
  const date = h2hObj.date ?? "";
  return `${date ? (date+" • ") : ""}Score ${s} • Corners ${c} • Cards ${cards}`;
}

function parseTeamXG(leagueKey, teamName){
  const L = getLeagueObj(leagueKey);
  if (!L || !L.teams) return null;
  // exact match first
  if (L.teams[teamName]) return L.teams[teamName];

  // fallback: case-insensitive match
  const target = normalizeTeam(teamName);
  for (const [k,v] of Object.entries(L.teams)){
    if (normalizeTeam(k) === target) return v;
  }
  return null;
}

function computeMatch(leagueKey, home, away){
  const hxg = parseTeamXG(leagueKey, home);
  const axg = parseTeamXG(leagueKey, away);

  if (!hxg || !axg) {
    return { error: `Team not found in ${leagueKey}. Check spelling or update xg_tables.json.` };
  }

  // Use provided lambdas if present, else build naive from attack/defense if present
  const homeLambda = (hxg.lambda_for != null) ? hxg.lambda_for : (hxg.xg_for ?? 1.35);
  const awayLambda = (axg.lambda_for != null) ? axg.lambda_for : (axg.xg_for ?? 1.25);

  const sim = mcSim(homeLambda, awayLambda, MC_SIMS);
  const score = expectedMostLikelyScoreFromPoisson(homeLambda, awayLambda);

  const bestProb = Math.max(sim.pHome, sim.pDraw, sim.pAway);
  const tier = confidenceTier(bestProb);

  const h2h = findH2H(leagueKey, home, away);

  // EV flags (optional)
  const evs = [];
  const evHome = evFlag(sim.pHome, safeNum(els.oddsHome.value));
  if (evHome) evs.push(`ML Home: ${evHome.flag} (${(evHome.ev*100).toFixed(1)}%)`);
  const evDraw = evFlag(sim.pDraw, safeNum(els.oddsDraw.value));
  if (evDraw) evs.push(`ML Draw: ${evDraw.flag} (${(evDraw.ev*100).toFixed(1)}%)`);
  const evAway = evFlag(sim.pAway, safeNum(els.oddsAway.value));
  if (evAway) evs.push(`ML Away: ${evAway.flag} (${(evAway.ev*100).toFixed(1)}%)`);

  const evO = evFlag(sim.pO25, safeNum(els.oddsO25Over.value));
  if (evO) evs.push(`O2.5 Over: ${evO.flag} (${(evO.ev*100).toFixed(1)}%)`);
  const evU = evFlag(1 - sim.pO25, safeNum(els.oddsO25Under.value));
  if (evU) evs.push(`O2.5 Under: ${evU.flag} (${(evU.ev*100).toFixed(1)}%)`);

  const evAH = evFlag(sim.pHome, safeNum(els.oddsAHHome05.value)); // rough proxy
  if (evAH) evs.push(`AH Home -0.5: ${evAH.flag} (${(evAH.ev*100).toFixed(1)}%)`);

  // corners/cards EV optional (if user fills lines/odds). We don't model corners/cards yet → label as "Input-based only".
  // We keep this sellable: next upgrade can model corners/cards from team averages.
  const evText = evs.length ? evs.join(" • ") : "—";

  return {
    leagueKey,
    home, away,
    homeLambda, awayLambda,
    sim,
    score,
    ou25: ou25Label(sim.pO25),
    ah: ahLean(sim.pHome, sim.pDraw, sim.pAway),
    tier,
    evText,
    h2hText: buildH2HString(h2h),
  };
}

function renderSingle(res){
  if (res.error){
    els.rLeague.textContent = "—";
    els.rMatch.textContent = res.error;
    els.rXg.textContent = "—";
    els.rScore.textContent = "—";
    els.rO25.textContent = "—";
    els.rAH.textContent = "—";
    els.rHDA.textContent = "—";
    els.rEV.textContent = "—";
    els.rConf.textContent = "—";
    els.rTop.textContent = "—";
    els.rH2H.textContent = "—";
    return;
  }

  els.rLeague.textContent = res.leagueKey;
  els.rMatch.textContent = `${res.home} vs ${res.away}`;
  els.rXg.textContent = `Home λ ${res.homeLambda.toFixed(2)} / Away λ ${res.awayLambda.toFixed(2)}`;
  els.rScore.textContent = res.score;
  els.rO25.textContent = res.ou25;
  els.rAH.textContent = res.ah;
  els.rHDA.textContent = `H ${fmtPct(res.sim.pHome)} / D ${fmtPct(res.sim.pDraw)} / A ${fmtPct(res.sim.pAway)}`;
  els.rEV.textContent = res.evText;
  els.rConf.textContent = res.tier;

  const topStr = res.sim.top.map(t=>`${t.score} (${(t.p*100).toFixed(1)}%)`).join(", ");
  els.rTop.textContent = topStr || "—";

  els.rH2H.textContent = res.h2hText || "—";
}

function renderAutoRows(rows){
  els.autoBody.innerHTML = "";
  if (!rows.length){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted" colspan="8">No fixtures found. Add matches in fixtures.json.</td>`;
    els.autoBody.appendChild(tr);
    return;
  }

  rows.forEach(r=>{
    const tr = document.createElement("tr");
    const top2 = r.sim.top.slice(0,2).map(t=>`${t.score} (${(t.p*100).toFixed(1)}%)`).join(", ");
    const h2hShort = (r.h2hText && r.h2hText !== "—") ? r.h2hText : "—";

    tr.innerHTML = `
      <td><div><b>${r.leagueKey}:</b> ${r.home} vs ${r.away}</div><div class="muted">${r.date ? r.date : ""}</div></td>
      <td><b>${r.score}</b></td>
      <td>H ${Math.round(r.sim.pHome*100)} / D ${Math.round(r.sim.pDraw*100)} / A ${Math.round(r.sim.pAway*100)}</td>
      <td>${Math.round(r.sim.pO25*100)}%</td>
      <td class="muted">${top2}</td>
      <td class="muted">${r.evText}</td>
      <td>${r.tier}</td>
      <td class="muted">${h2hShort}</td>
    `;
    els.autoBody.appendChild(tr);
  });
}

function loadAll(){
  els.loadedLine.textContent = "Loading xG…";

  return Promise.all([
    fetch("./xg_tables.json").then(r=>r.json()).catch(()=>null),
    fetch("./fixtures.json").then(r=>r.json()).catch(()=>null),
    fetch("./h2h.json").then(r=>r.json()).catch(()=>null),
  ]).then(([xg,fix,h2h])=>{
    XG = xg;
    FIX = fix;
    H2H = h2h;

    if (!XG){
      els.loadedLine.textContent = "xG failed to load. Make sure xg_tables.json exists in repo root.";
      return;
    }

    const leagues = pickLeagueKeys().sort((a,b)=>a.localeCompare(b));
    els.leagueSelect.innerHTML = "";
    leagues.forEach(k=>{
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      els.leagueSelect.appendChild(opt);
    });

    const first = leagues[0];
    if (first){
      const teams = buildTeamsListForLeague(first);
      updateDatalist(teams);
    }

    els.leagueSelect.addEventListener("change", ()=>{
      const leagueKey = els.leagueSelect.value;
      const teams = buildTeamsListForLeague(leagueKey);
      updateDatalist(teams);
    });

    els.loadedLine.textContent = `xG loaded ✓ (${leagues.length} leagues)`;
  });
}

els.runBtn.addEventListener("click", ()=>{
  const leagueKey = els.leagueSelect.value;
  const home = els.homeTeam.value.trim();
  const away = els.awayTeam.value.trim();
  if (!leagueKey || !home || !away){
    renderSingle({error:"Pick league + type both teams."});
    return;
  }
  const res = computeMatch(leagueKey, home, away);
  renderSingle(res);
});

els.runAllBtn.addEventListener("click", ()=>{
  if (!FIX || !XG){
    renderAutoRows([]);
    return;
  }

  const all = [];
  const todays = todayISO();

  // fixtures.json format supports:
  // { "EPL":[ {"home":"Arsenal","away":"Aston Villa","date":"2026-02-04"} ], "LaLiga":[...]}
  // OR { "fixtures":[ {league:"EPL", home:"...", away:"...", date:"..."} ] }
  if (Array.isArray(FIX.fixtures)){
    FIX.fixtures.forEach(f=>{
      const res = computeMatch(f.league, f.home, f.away);
      if (!res.error) res.date = f.date || "";
      all.push(res);
    });
  } else {
    for (const [leagueKey, list] of Object.entries(FIX)){
      if (!Array.isArray(list)) continue;
      list.forEach(f=>{
        const res = computeMatch(leagueKey, f.home, f.away);
        if (!res.error) res.date = f.date || "";
        all.push(res);
      });
    }
  }

  // sort: today's fixtures first, then by league
  all.sort((a,b)=>{
    const aT = a.date === todays ? 0 : 1;
    const bT = b.date === todays ? 0 : 1;
    if (aT !== bT) return aT - bT;
    if (a.leagueKey !== b.leagueKey) return a.leagueKey.localeCompare(b.leagueKey);
    return (a.home+a.away).localeCompare(b.home+b.away);
  });

  renderAutoRows(all);
});

// boot
loadAll();
