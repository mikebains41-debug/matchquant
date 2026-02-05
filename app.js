// MatchQuant - app.js (FULL REPLACEMENT)
// Loads: xg_tables.json, fixtures.json, h2h.json
// Produces: scoreline + 1X2 + O/U probs + BTTS + AH lean + corners/cards + pro grade + EV tag

const $ = (id) => document.getElementById(id);

const state = {
  xg: null,
  fixtures: [],
  h2h: null,
  leagues: [],
  leagueTeams: [],         // team names for selected league
  leagueFixtures: [],      // fixtures for selected league
  selectedLeague: "",
  selectedFixtureKey: "",
};

function setBadge(dotId, labelId, ok, text){
  const dot = $(dotId);
  const lbl = $(labelId);
  dot.className = "dot" + (ok ? " ok" : "");
  lbl.textContent = text;
}

function safeNum(x, fallback=null){
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function slug(s){
  return String(s).trim().toLowerCase().replace(/\s+/g," ").replace(/[^\w\s-]/g,"").replace(/\s/g,"_");
}

function fixtureKey(f){
  // stable key used for dropdown
  return `${slug(f.league)}__${slug(f.home)}__${slug(f.away)}__${String(f.date||"")}`;
}

async function fetchJson(path){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return await res.json();
}

function uniq(arr){
  return [...new Set(arr)];
}

function impliedProbFromDecimalOdds(odds){
  // odds: decimal
  if(!odds || odds <= 1.0001) return null;
  return 1 / odds;
}

function normalizeProbs(pArr){
  const sum = pArr.reduce((a,b)=>a+b,0);
  if(sum <= 0) return pArr;
  return pArr.map(p=>p/sum);
}

function poissonPmf(k, lambda){
  // stable-ish for small k
  let p = Math.exp(-lambda);
  for(let i=1;i<=k;i++) p *= lambda / i;
  return p;
}

function samplePoisson(lambda, cap){
  // inverse CDF sampling (fast enough for cap <= 10)
  const u = Math.random();
  let cdf = 0;
  for(let k=0;k<=cap;k++){
    cdf += poissonPmf(k, lambda);
    if(u <= cdf) return k;
  }
  return cap;
}

function mostLikelyScore(scoreCounts){
  // scoreCounts keyed as "h-a"
  let best = null, bestV = -1;
  for(const [k,v] of Object.entries(scoreCounts)){
    if(v > bestV){ bestV = v; best = k; }
  }
  if(!best) return {h:0,a:0,key:"0-0"};
  const [h,a] = best.split("-").map(x=>parseInt(x,10));
  return {h, a, key: best};
}

function ahCandidateLines(){
  // common quarter lines for HOME
  return [-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
}

function coverProbForHomeAH(line, diffSamples){
  // diff = homeGoals - awayGoals
  // For simplicity, treat quarter lines with half-win/half-loss approximation
  // This is an approximation but works well for ranking "lean" + cover%
  let cover = 0;
  for(const d of diffSamples){
    const x = d - line; // positive means home covers
    if(line % 1 === 0){
      // integer: push at 0
      if(x > 0) cover += 1;
      else if(x === 0) cover += 0.5; // treat push as half
    } else if (Math.abs(line*4 - Math.round(line*4)) < 1e-9 && Math.abs(line*2 - Math.round(line*2)) > 1e-9){
      // quarter line: split into two half-lines (e.g. -0.75 = -0.5 and -1.0)
      const half1 = line + 0.25;
      const half2 = line - 0.25;
      const x1 = d - half1;
      const x2 = d - half2;
      const s1 = x1 > 0 ? 1 : (x1 === 0 ? 0.5 : 0);
      const s2 = x2 > 0 ? 1 : (x2 === 0 ? 0.5 : 0);
      cover += 0.5*(s1+s2);
    } else {
      // half line (.5): no push
      if(x > 0) cover += 1;
    }
  }
  return cover / diffSamples.length;
}

function proGrade({edge, certainty}){
  // edge in decimal (0.05 = 5%), certainty 0..1
  if(edge >= 0.06 && certainty >= 0.62) return "A";
  if(edge >= 0.03 && certainty >= 0.58) return "B";
  return "C";
}

function certaintyFromDistribution({pHome,pDraw,pAway}){
  // higher max prob => more certainty
  const m = Math.max(pHome,pDraw,pAway);
  return m; // simple proxy
}

function fmtPct(x){
  return `${Math.round(x*100)}%`;
}

function fmt2(x){
  return (Math.round(x*100)/100).toFixed(2);
}

function buildOption(selectEl, value, label){
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  selectEl.appendChild(opt);
}

function clearSelect(selectEl, placeholder){
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
}

function setStatus(msg){
  $("statusLine").textContent = msg;
}

function getTeamRow(league, team){
  if(!state.xg?.[league]) return null;
  return state.xg[league][team] || null;
}

function leagueFactorAuto(league){
  return safeNum(state.xg?.[league]?.__league_factor, 1.00);
}

function predictCornersCards(league, home, away, meanGoals){
  const h = getTeamRow(league, home);
  const a = getTeamRow(league, away);

  // If real corners/cards exist in xg_tables, use them:
  const hasCorners = h && a && (h.corners_for!=null || h.corners_for===0) && (a.corners_for!=null || a.corners_for===0);
  const hasCards   = h && a && (h.cards_for!=null || h.cards_for===0) && (a.cards_for!=null || a.cards_for===0);

  let corners, cards;

  if(hasCorners){
    // Expected corners = avg of home "for" + away "against", and vice versa
    const hFor = safeNum(h.corners_for, 5.0);
    const hAg  = safeNum(h.corners_against, 5.0);
    const aFor = safeNum(a.corners_for, 5.0);
    const aAg  = safeNum(a.corners_against, 5.0);
    const homeCorners = (hFor + aAg)/2;
    const awayCorners = (aFor + hAg)/2;
    corners = homeCorners + awayCorners;
  } else {
    // Proxy: corners scale with tempo + chance volume
    corners = 8.0 + (meanGoals - 2.4) * 1.4;
  }

  if(hasCards){
    const hFor = safeNum(h.cards_for, 2.0);
    const hAg  = safeNum(h.cards_against, 2.0);
    const aFor = safeNum(a.cards_for, 2.0);
    const aAg  = safeNum(a.cards_against, 2.0);
    const homeCards = (hFor + aAg)/2;
    const awayCards = (aFor + hAg)/2;
    cards = homeCards + awayCards;
  } else {
    // Proxy: big matches / close matches -> more cards
    cards = 3.6 + Math.max(0, (2.9 - meanGoals)) * 0.35;
  }

  corners = Math.max(5.5, Math.min(13.5, corners));
  cards   = Math.max(2.0, Math.min(7.5, cards));
  return { corners, cards, usedReal: hasCorners && hasCards };
}

function runMonteCarlo({league, home, away, sims, cap, homeAdv, baseGoals, leagueFactorOverride}){
  const h = getTeamRow(league, home);
  const a = getTeamRow(league, away);
  if(!h || !a) throw new Error(`Missing xG rows for ${league}: ${home} or ${away}`);

  const lf = (leagueFactorOverride!=null) ? leagueFactorOverride : leagueFactorAuto(league);

  // Lambdas:
  // lambdaHome ~ baseGoals * leagueFactor * homeAdv * attHome * defAway
  // lambdaAway ~ baseGoals * leagueFactor * (1/homeAdv) * attAway * defHome
  const attH = safeNum(h.att, 1.0);
  const defH = safeNum(h.def, 1.0);
  const attA = safeNum(a.att, 1.0);
  const defA = safeNum(a.def, 1.0);

  const lambdaHome = baseGoals * lf * homeAdv * attH * defA;
  const lambdaAway = baseGoals * lf * (1/homeAdv) * attA * defH;

  let homeW=0, draw=0, awayW=0;
  let over25=0, over35=0, btts=0;
  const scoreCounts = {};
  const diffSamples = new Array(sims);

  for(let i=0;i<sims;i++){
    const hg = samplePoisson(lambdaHome, cap);
    const ag = samplePoisson(lambdaAway, cap);
    const key = `${hg}-${ag}`;
    scoreCounts[key] = (scoreCounts[key]||0)+1;

    const d = hg - ag;
    diffSamples[i] = d;

    if(d>0) homeW++;
    else if(d===0) draw++;
    else awayW++;

    const tg = hg+ag;
    if(tg>=3) over25++;
    if(tg>=4) over35++;
    if(hg>=1 && ag>=1) btts++;
  }

  const pHome = homeW/sims;
  const pDraw = draw/sims;
  const pAway = awayW/sims;

  const pOver25 = over25/sims;
  const pUnder25 = 1 - pOver25;

  const pOver35 = over35/sims;
  const pUnder35 = 1 - pOver35;

  const pBTTS = btts/sims;

  const ml = mostLikelyScore(scoreCounts);
  const meanGoals = lambdaHome + lambdaAway;

  // AH lean: choose line with biggest cover distance from 50%
  let bestLine = 0, bestEdge = 0, bestCover = 0.5;
  for(const line of ahCandidateLines()){
    const cover = coverProbForHomeAH(line, diffSamples);
    const edge = Math.abs(cover - 0.5);
    if(edge > bestEdge){
      bestEdge = edge;
      bestLine = line;
      bestCover = cover;
    }
  }

  return {
    lambdaHome, lambdaAway, lf,
    pHome, pDraw, pAway,
    pOver25, pUnder25, pOver35, pUnder35,
    pBTTS,
    mostLikely: ml,
    meanGoals,
    ah: { lineHome: bestLine, coverHome: bestCover },
  };
}

function market1x2Edge(sim, odds){
  // odds: {home, draw, away} decimals
  const iHome = impliedProbFromDecimalOdds(odds?.home);
  const iDraw = impliedProbFromDecimalOdds(odds?.draw);
  const iAway = impliedProbFromDecimalOdds(odds?.away);
  if(iHome==null || iDraw==null || iAway==null) return null;

  const [mHome,mDraw,mAway] = normalizeProbs([iHome,iDraw,iAway]);
  // edge vs market on best pick
  const diffs = [
    {k:"H", edge: sim.pHome - mHome, prob: sim.pHome},
    {k:"D", edge: sim.pDraw - mDraw, prob: sim.pDraw},
    {k:"A", edge: sim.pAway - mAway, prob: sim.pAway},
  ].sort((a,b)=>b.edge-a.edge);
  return { best: diffs[0], market:{mHome,mDraw,mAway} };
}

function renderSingleOutput({league, home, away, sim, odds, cornersCards, pro}){
  const o = $("output");
  o.style.display = "block";

  const ahLine = sim.ah.lineHome;
  const ahSide = (sim.ah.coverHome >= 0.5) ? `Home ${ahLine>=0?"+":""}${ahLine}` : `Away ${ahLine>=0?"+":""}${-ahLine}`;
  const ahCover = fmtPct(Math.max(sim.ah.coverHome, 1 - sim.ah.coverHome));

  const certainty = certaintyFromDistribution(sim);
  const grade = proGrade({edge: pro?.edge ?? 0, certainty});

  const evTxt = pro?.edge != null
    ? (pro.edge >= safeNum($("evInput").value, 0.03) ? `EV: +${fmtPct(pro.edge)} ✅` : `EV: +${fmtPct(pro.edge)} (small)`)
    : "EV: n/a";

  o.innerHTML = `
    <div class="small">Model</div>
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
      <div>
        <div style="font-size:22px; font-weight:800;">${home} vs ${away}</div>
        <div class="small">${league} • league factor ${fmt2(sim.lf)} • λ ${fmt2(sim.lambdaHome)} / ${fmt2(sim.lambdaAway)}</div>
      </div>
      <div style="text-align:right;">
        <div class="small">Pred</div>
        <div style="font-size:24px; font-weight:900;">${sim.mostLikely.h}-${sim.mostLikely.a}</div>
      </div>
    </div>

    <div class="pillrow">
      <div class="pill good">1X2: H ${fmtPct(sim.pHome)} • D ${fmtPct(sim.pDraw)} • A ${fmtPct(sim.pAway)}</div>
      <div class="pill warn">O/U 2.5: Over ${fmtPct(sim.pOver25)} • Under ${fmtPct(sim.pUnder25)}</div>
      <div class="pill warn">O/U 3.5: Over ${fmtPct(sim.pOver35)} • Under ${fmtPct(sim.pUnder35)}</div>
      <div class="pill">BTTS Yes: ${fmtPct(sim.pBTTS)}</div>
      <div class="pill">AH lean: ${ahSide} (${ahCover} cover)</div>
      <div class="pill">Corners: ${fmt2(cornersCards.corners)}</div>
      <div class="pill">Cards: ${fmt2(cornersCards.cards)}</div>
      <div class="pill ${grade==="A"?"good":grade==="B"?"warn":"bad"}">Pro grade: ${grade}</div>
      <div class="pill">${evTxt}</div>
    </div>

    <div class="note">Score is the most likely score from sims (not average). AH/corners/cards use real team fields if present; otherwise proxies.</div>
  `;
}

function renderH2H(league, home, away){
  const box = $("h2hBox");
  box.style.display = "block";

  const key1 = `${slug(league)}__${slug(home)}__${slug(away)}`;
  const key2 = `${slug(league)}__${slug(away)}__${slug(home)}`;
  const rec = state.h2h?.[key1] || state.h2h?.[key2];

  if(!rec){
    box.innerHTML = `<div class="small">Last H2H</div><div style="font-size:16px; font-weight:700;">—</div>`;
    return;
  }
  box.innerHTML = `
    <div class="small">Last H2H</div>
    <div style="font-size:16px; font-weight:800;">${rec.home} ${rec.score} ${rec.away}</div>
    <div class="small">Cards: ${rec.cards ?? "—"} • Corners: ${rec.corners ?? "—"} • Date: ${rec.date ?? "—"}</div>
  `;
}

function renderFixturesTable(league){
  const box = $("fixturesBox");
  box.style.display = "block";
  const fs = state.leagueFixtures;

  if(!fs.length){
    box.innerHTML = `<div class="small">Fixtures</div><div style="font-weight:800;">No fixtures for ${league} in fixtures.json</div>`;
    return;
  }

  // Build table with pro columns (computed on-demand quickly per fixture)
  let html = `<div class="small">Fixtures</div><div class="small">Tap a row to auto-fill predictor</div>`;
  html += `<table>
    <thead>
      <tr>
        <th>#</th>
        <th>Match</th>
        <th>Pred</th>
        <th>1X2</th>
        <th>O/U 2.5</th>
        <th>O/U 3.5</th>
        <th>BTTS</th>
        <th>AH</th>
        <th>Corners</th>
        <th>Cards</th>
        <th>Pro</th>
      </tr>
    </thead><tbody>`;

  const sims = Math.min(4000, safeNum($("simsInput").value, 10000)); // lighter for table
  const cap  = safeNum($("capInput").value, 8);
  const ha   = safeNum($("haInput").value, 1.10);
  const bg   = safeNum($("baseGoalsInput").value, 1.35);
  const lfOv = safeNum($("leagueFactorInput").value, null);

  fs.forEach((f, idx) => {
    let pred = "—";
    let p1x2 = "—";
    let ou25 = "—";
    let ou35 = "—";
    let btts = "—";
    let ah = "—";
    let cor = "—";
    let car = "—";
    let proG = "—";

    try{
      const sim = runMonteCarlo({
        league, home:f.home, away:f.away,
        sims, cap, homeAdv:ha, baseGoals:bg,
        leagueFactorOverride: lfOv
      });
      pred = `${sim.mostLikely.h}-${sim.mostLikely.a}`;
      p1x2 = `H ${fmtPct(sim.pHome)} • D ${fmtPct(sim.pDraw)} • A ${fmtPct(sim.pAway)}`;
      ou25 = `O ${fmtPct(sim.pOver25)} • U ${fmtPct(sim.pUnder25)}`;
      ou35 = `O ${fmtPct(sim.pOver35)} • U ${fmtPct(sim.pUnder35)}`;
      btts = fmtPct(sim.pBTTS);

      const ahLine = sim.ah.lineHome;
      const side = (sim.ah.coverHome >= 0.5) ? `H ${ahLine>=0?"+":""}${ahLine}` : `A ${ahLine>=0?"+":""}${-ahLine}`;
      const cover = fmtPct(Math.max(sim.ah.coverHome, 1-sim.ah.coverHome));
      ah = `${side} (${cover})`;

      const cc = predictCornersCards(league, f.home, f.away, sim.meanGoals);
      cor = fmt2(cc.corners);
      car = fmt2(cc.cards);

      const cert = certaintyFromDistribution(sim);
      const edgeObj = market1x2Edge(sim, f.odds);
      const bestEdge = edgeObj?.best?.edge ?? 0;
      proG = proGrade({edge: bestEdge, certainty: cert});
    }catch(e){
      // leave dashes
    }

    const k = fixtureKey(f);
    html += `<tr data-k="${k}" style="cursor:pointer;">
      <td class="mono">${idx+1}</td>
      <td><div style="font-weight:800;">${f.home} vs ${f.away}</div><div class="small">${league} • ${f.date ?? ""}</div></td>
      <td style="font-weight:800;">${pred}</td>
      <td class="small">${p1x2}</td>
      <td class="small">${ou25}</td>
      <td class="small">${ou35}</td>
      <td class="small">${btts}</td>
      <td class="small">${ah}</td>
      <td class="small">${cor}</td>
      <td class="small">${car}</td>
      <td style="font-weight:900;">${proG}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  box.innerHTML = html;

  // tap-to-fill
  box.querySelectorAll("tr[data-k]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const k = tr.getAttribute("data-k");
      const f = state.leagueFixtures.find(x => fixtureKey(x)===k);
      if(!f) return;

      $("fixtureSelect").value = k;
      $("homeSelect").value = f.home;
      $("awaySelect").value = f.away;
      setStatus(`✅ Ready: ${state.selectedLeague} — ${f.home} vs ${f.away}`);
      $("output").style.display = "none";
      $("h2hBox").style.display = "none";
      window.scrollTo({top:0, behavior:"smooth"});
    });
  });
}

function rebuildLeagueDropdown(){
  const sel = $("leagueSelect");
  clearSelect(sel, "Select League");

  state.leagues = Object.keys(state.xg || {}).filter(k => !k.startsWith("__"));
  // Remove special keys accidentally included
  state.leagues = state.leagues.filter(l => typeof state.xg[l] === "object");

  state.leagues.sort((a,b)=>a.localeCompare(b));
  state.leagues.forEach(l => buildOption(sel, l, l));
}

function rebuildTeamsForLeague(league){
  const homeSel = $("homeSelect");
  const awaySel = $("awaySelect");

  clearSelect(homeSel, "Select home team");
  clearSelect(awaySel, "Select away team");

  const table = state.xg?.[league] || {};
  const teams = Object.keys(table).filter(k => !k.startsWith("__"));
  teams.sort((a,b)=>a.localeCompare(b));

  state.leagueTeams = teams;

  teams.forEach(t=>{
    buildOption(homeSel, t, t);
    buildOption(awaySel, t, t);
  });

  homeSel.disabled = false;
  awaySel.disabled = false;
}

function rebuildFixturesForLeague(league){
  const fxSel = $("fixtureSelect");
  clearSelect(fxSel, "Select Fixture (optional)");

  const list = (state.fixtures || []).filter(f => String(f.league||"") === league);
  state.leagueFixtures = list;

  if(list.length){
    list.forEach(f=>{
      const k = fixtureKey(f);
      const label = `${f.home} vs ${f.away}${f.date ? " • "+f.date : ""}`;
      buildOption(fxSel, k, label);
    });
    fxSel.disabled = false;
  } else {
    fxSel.disabled = true;
  }
}

function wireEvents(){
  $("leagueSelect").addEventListener("change", ()=>{
    const league = $("leagueSelect").value;
    state.selectedLeague = league;

    $("output").style.display = "none";
    $("h2hBox").style.display = "none";

    if(!league){
      $("fixtureSelect").disabled = true;
      $("homeSelect").disabled = true;
      $("awaySelect").disabled = true;
      setStatus("Choose a league + teams (or pick a fixture), then Run.");
      return;
    }

    rebuildFixturesForLeague(league);
    rebuildTeamsForLeague(league);
    renderFixturesTable(league);

    setStatus(`League selected: ${league}`);
  });

  $("fixtureSelect").addEventListener("change", ()=>{
    const k = $("fixtureSelect").value;
    if(!k) return;

    const f = state.leagueFixtures.find(x => fixtureKey(x)===k);
    if(!f) return;

    $("homeSelect").value = f.home;
    $("awaySelect").value = f.away;
    setStatus(`✅ Ready: ${state.selectedLeague} — ${f.home} vs ${f.away}`);
  });

  $("homeSelect").addEventListener("change", ()=>{
    const h = $("homeSelect").value;
    const a = $("awaySelect").value;
    if(h && a) setStatus(`✅ Ready: ${state.selectedLeague} — ${h} vs ${a}`);
  });

  $("awaySelect").addEventListener("change", ()=>{
    const h = $("homeSelect").value;
    const a = $("awaySelect").value;
    if(h && a) setStatus(`✅ Ready: ${state.selectedLeague} — ${h} vs ${a}`);
  });

  $("runBtn").addEventListener("click", ()=>{
    try{
      const league = $("leagueSelect").value;
      const home = $("homeSelect").value;
      const away = $("awaySelect").value;

      if(!league || !home || !away){
        setStatus("Pick league + home + away (or choose a fixture).");
        return;
      }
      if(home === away){
        setStatus("Home and away can’t be the same team.");
        return;
      }

      const sims = Math.max(2000, safeNum($("simsInput").value, 10000));
      const cap  = safeNum($("capInput").value, 8);
      const ha   = safeNum($("haInput").value, 1.10);
      const bg   = safeNum($("baseGoalsInput").value, 1.35);
      const lfOv = safeNum($("leagueFactorInput").value, null);

      const sim = runMonteCarlo({
        league, home, away, sims,
        cap, homeAdv:ha, baseGoals:bg,
        leagueFactorOverride: lfOv
      });

      const cc = predictCornersCards(league, home, away, sim.meanGoals);

      // Find odds for this matchup if fixture exists:
      const f = state.leagueFixtures.find(x => x.home===home && x.away===away) ||
                state.leagueFixtures.find(x => x.home===away && x.away===home);
      const edgeObj = market1x2Edge(sim, f?.odds);
      const pro = edgeObj ? { edge: edgeObj.best.edge, pick: edgeObj.best.k } : null;

      renderSingleOutput({league, home, away, sim, odds:f?.odds, cornersCards:cc, pro});
      renderH2H(league, home, away);

      setStatus(`✅ Done: ${league} — ${home} vs ${away}`);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }catch(e){
      console.error(e);
      setStatus(`Error: ${e.message}`);
    }
  });
}

async function init(){
  try{
    const [fixtures, xg, h2h] = await Promise.all([
      fetchJson("./fixtures.json"),
      fetchJson("./xg_tables.json"),
      fetchJson("./h2h.json").catch(()=> ({}))
    ]);

    state.fixtures = Array.isArray(fixtures) ? fixtures : [];
    state.xg = xg || {};
    state.h2h = h2h || {};

    setBadge("dotFixtures","lblFixtures", true, `fixtures.json (${state.fixtures.length})`);
    const teamCount = Object.values(state.xg||{})
      .filter(v=>v && typeof v==="object")
      .reduce((acc, leagueObj)=>{
        const teams = Object.keys(leagueObj).filter(k=>!k.startsWith("__"));
        return acc + teams.length;
      },0);
    setBadge("dotXg","lblXg", true, `xg_tables.json (${teamCount} teams)`);
    setBadge("dotH2h","lblH2h", true, `h2h.json (ok)`);

    rebuildLeagueDropdown();
    wireEvents();
    setStatus("Loaded. Pick a league.");
  } catch (e){
    console.error(e);
    setBadge("dotFixtures","lblFixtures", false, `fixtures.json (error)`);
    setBadge("dotXg","lblXg", false, `xg_tables.json (error)`);
    setBadge("dotH2h","lblH2h", false, `h2h.json (error)`);
    setStatus(`Load error: ${e.message}`);
  }
}

init();
