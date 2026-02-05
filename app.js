/* MatchQuant - PRO build
   Loads:
   - xg_tables.json  (league -> team -> {att, def, corners_for?, corners_against?, cards_for?, cards_against?})
   - fixtures.json   (array of fixtures; can optionally include odds)
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
  const leagueKeys = ["league","League","competition","Competition","name","Name"];
  const factorKeys = ["factor","Factor","lf","LF","league_factor","LeagueFactor"];
  const m = new Map();

  for (const r of rows){
    let lk=null, fk=null;
    for (const k of leagueKeys) if (k in r) { lk = r[k]; break; }
    for (const k of factorKeys) if (k in r) { fk = r[k]; break; }
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

function uniq(arr){ return [...new Set(arr)]; }
function sortAlpha(arr){ return [...arr].sort((a,b)=>a.localeCompare(b)); }
function scorelineKey(h,a){ return `${h}-${a}`; }

// Poisson sampler (Knuth)
function poisson(lambda){
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1.0;
  do { k++; p *= Math.random(); } while (p > L && k < 64);
  return k - 1;
}

function simMatch({lambdaH, lambdaA, sims, maxGoals}){
  const scoreCounts = new Map();
  let homeW=0, draw=0, awayW=0;
  let over25=0, under25=0;
  let bttsYes=0;
  let totalGoalsSum=0;
  let goalDiffSum=0;

  // AH lines we’ll evaluate (common)
  const ahLines = [-2.0,-1.5,-1.0,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1.0,1.5,2.0];
  const ahWinCounts = new Map(ahLines.map(l => [String(l), 0])); // P(home covers)
  const ahLoseCounts = new Map(ahLines.map(l => [String(l), 0])); // P(home fails)

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
    totalGoalsSum += tot;
    goalDiffSum += (hg - ag);

    if (tot > 2) over25++;
    else under25++;

    if (hg > 0 && ag > 0) bttsYes++;

    // AH eval (approx: treat “cover” as hg + line > ag)
    for (const line of ahLines){
      const adj = hg + line;
      if (adj > ag) ahWinCounts.set(String(line), ahWinCounts.get(String(line)) + 1);
      else ahLoseCounts.set(String(line), ahLoseCounts.get(String(line)) + 1);
    }
  }

  let bestKey="0-0", bestC=-1;
  for (const [k,c] of scoreCounts.entries()){
    if (c > bestC){ bestC = c; bestKey = k; bestC = c; }
  }

  const pct = (n)=> Math.round((n / sims) * 100);

  // Choose an “AH lean” line: closest to 50/50 cover probability but >50
  let bestAh = null;
  let bestAhP = 0;
  for (const [k,v] of ahWinCounts.entries()){
    const p = v / sims;
    if (p >= 0.50){
      // prefer nearer to 0.55 (safer)
      const score = Math.abs(p - 0.55);
      if (!bestAh || score < bestAh.score){
        bestAh = { line: Number(k), pCover: p, score };
        bestAhP = p;
      }
    }
  }
  if (!bestAh){
    // if none >= 50, take closest to 45 (dog-ish)
    let alt = null;
    for (const [k,v] of ahWinCounts.entries()){
      const p = v / sims;
      const score = Math.abs(p - 0.45);
      if (!alt || score < alt.score) alt = { line: Number(k), pCover:p, score };
    }
    bestAh = alt;
    bestAhP = alt?.pCover ?? 0.5;
  }

  return {
    bestScore: bestKey,
    pH: pct(homeW),
    pD: pct(draw),
    pA: pct(awayW),
    pOver25: pct(over25),
    pUnder25: pct(under25),
    pBTTS: pct(bttsYes),
    meanGoals: +(totalGoalsSum / sims).toFixed(2),
    meanDiff: +(goalDiffSum / sims).toFixed(2),
    ahLean: bestAh ? { line: bestAh.line, pCover: Math.round(bestAhP*100) } : { line: -0.5, pCover: 50 }
  };
}

function getTeamRow(league, team){
  const L = state.xg?.[league];
  if (!L) return { missing:true };
  const t = L[team];
  if (!t) return { missing:true };
  return { ...t, missing:false };
}

function getTeamXg(league, team){
  const t = getTeamRow(league, team);
  const att = Number(t.att);
  const def = Number(t.def);
  if (!Number.isFinite(att) || !Number.isFinite(def)) return { att:1.0, def:1.0, missing:true };
  return { att, def, missing:false };
}

function getTeamExtras(league, team){
  const t = getTeamRow(league, team);
  // optional fields (if you add them later)
  const cf = Number(t.corners_for);
  const ca = Number(t.corners_against);
  const kf = Number(t.cards_for);
  const ka = Number(t.cards_against);

  return {
    corners_for: Number.isFinite(cf) ? cf : null,
    corners_against: Number.isFinite(ca) ? ca : null,
    cards_for: Number.isFinite(kf) ? kf : null,
    cards_against: Number.isFinite(ka) ? ka : null,
    missing: !!t.missing
  };
}

function computeLambdas({league, home, away, baseGoals, homeAdv}){
  const lf = state.leagueFactor.get(league) ?? 1.0;
  const hx = getTeamXg(league, home);
  const ax = getTeamXg(league, away);

  const lambdaH = clamp(baseGoals * lf * homeAdv * hx.att * ax.def, 0.05, 4.25);
  const lambdaA = clamp(baseGoals * lf * ax.att * hx.def, 0.05, 4.25);

  return { lambdaH, lambdaA, lf, hx, ax };
}

function matchId(league, home, away){
  return `${league}__${home}__${away}`.toLowerCase();
}

function readLastH2H(league, home, away){
  if (!state.h2h) return null;

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

  if (state.h2h[league]?.[home]?.[away]) return state.h2h[league][home][away];
  if (state.h2h[league]?.[away]?.[home]) return state.h2h[league][away][home];

  return null;
}

function formatH2H(h2hObj){
  if (!h2hObj) return "—";
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

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

// -------- PRO METRICS (corners/cards + EV + confidence) --------

function predictCornersCards({league, home, away, meanGoals}){
  // If you later add corners/cards in xg_tables.json, we use them.
  // Otherwise we use a safe proxy from meanGoals.
  const hEx = getTeamExtras(league, home);
  const aEx = getTeamExtras(league, away);

  let corners = null;
  let cards = null;

  // corners: (home corners for + away corners against)/2 + (away for + home against)/2
  if (hEx.corners_for != null && aEx.corners_against != null && aEx.corners_for != null && hEx.corners_against != null){
    const hC = (hEx.corners_for + aEx.corners_against) / 2;
    const aC = (aEx.corners_for + hEx.corners_against) / 2;
    corners = +(hC + aC).toFixed(1);
  } else {
    // proxy: 8.6 baseline + 0.7 per expected goal above 2.5
    corners = +(8.6 + 0.7 * (meanGoals - 2.5)).toFixed(1);
    corners = clamp(corners, 6.5, 13.5);
  }

  // cards: proxy from intensity: baseline 3.8 + 0.3 per expected goal above 2.5
  if (hEx.cards_for != null && aEx.cards_against != null && aEx.cards_for != null && hEx.cards_against != null){
    const hK = (hEx.cards_for + aEx.cards_against) / 2;
    const aK = (aEx.cards_for + hEx.cards_against) / 2;
    cards = +(hK + aK).toFixed(1);
  } else {
    cards = +(3.8 + 0.3 * (meanGoals - 2.5)).toFixed(1);
    cards = clamp(cards, 2.5, 6.5);
  }

  return { corners, cards, usedProxy: (hEx.corners_for==null || hEx.cards_for==null) };
}

function impliedProbFromDecimal(odds){
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1) return null;
  return 1 / o;
}

function evFlag({pModel, oddsDecimal}){
  const ip = impliedProbFromDecimal(oddsDecimal);
  if (ip == null) return { flag:"—", edge:0 };

  const edge = pModel - ip; // positive = value
  const edgePct = Math.round(edge * 100);

  if (edge >= 0.05) return { flag:`✅ +EV (${edgePct}%)`, edge };
  if (edge <= -0.05) return { flag:`❌ -EV (${edgePct}%)`, edge };
  return { flag:`≈ Fair (${edgePct}%)`, edge };
}

function confidenceTag({pMain, separation, edge}){
  // pMain: main lean probability (0-1)
  // separation: how far from 33/34/33 (or 50/50)
  // edge: value edge vs implied prob if present
  const score = (pMain - 0.50) + (separation * 0.5) + (edge ? edge : 0);
  if (score >= 0.18) return "Tier 1";
  if (score >= 0.10) return "Tier 2";
  return "Tier 3";
}

function pickMainMarket(res){
  // choose main lean from 1X2 probabilities
  const pH = res.pH/100, pD = res.pD/100, pA = res.pA/100;
  let main = { key:"H", p:pH };
  if (pD > main.p) main = { key:"D", p:pD };
  if (pA > main.p) main = { key:"A", p:pA };
  const separation = main.p - ( (pH+pD+pA - main.p) / 2 ); // rough “gap”
  return { main, separation };
}

// -------- UI RENDERING --------

function renderSingleOutput(payload){
  const { league, home, away, sims, baseGoals, homeAdv, maxGoals } = payload;
  const { lambdaH, lambdaA, lf, hx, ax } = computeLambdas({ league, home, away, baseGoals, homeAdv });
  const res = simMatch({ lambdaH, lambdaA, sims, maxGoals });

  const missingNote = (hx.missing || ax.missing)
    ? `<div class="mini" style="margin-top:6px;color:#f59e0b">⚠ Missing xG for ${hx.missing ? home : ""}${hx.missing && ax.missing ? " & " : ""}${ax.missing ? away : ""} → using neutral 1.00/1.00</div>`
    : "";

  const pro = predictCornersCards({ league, home, away, meanGoals: res.meanGoals });

  els.singleOut.innerHTML = `
    <div class="split">
      <div>
        <div class="k">Model</div>
        <div style="font-weight:800;font-size:16px">${escapeHtml(home)} vs ${escapeHtml(away)}</div>
        <div class="mini">${escapeHtml(league)} • League factor ${lf.toFixed(2)} • λ ${lambdaH.toFixed(2)} / ${lambdaA.toFixed(2)}</div>
      </div>
      <div class="right">
        <div class="k">Pred</div>
        <div style="font-weight:900;font-size:18px" class="mono">${escapeHtml(res.bestScore)}</div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="row" style="justify-content:space-between">
      <div class="badge b-good">1X2: H ${res.pH}% • D ${res.pD}% • A ${res.pA}%</div>
      <div class="badge b-warn">O/U 2.5: Over ${res.pOver25}% • Under ${res.pUnder25}%</div>
    </div>
    <div class="row" style="justify-content:space-between; margin-top:8px">
      <div class="badge">BTTS Yes: ${res.pBTTS}%</div>
      <div class="badge">AH lean: Home ${res.ahLean.line >= 0 ? "+" : ""}${res.ahLean.line.toFixed(2)} (${res.ahLean.pCover}% cover)</div>
    </div>
    <div class="row" style="justify-content:space-between; margin-top:8px">
      <div class="badge">Corners: ${pro.corners}</div>
      <div class="badge">Cards: ${pro.cards}</div>
      <div class="badge">Mean goals: ${res.meanGoals}</div>
    </div>
    ${missingNote}
    ${pro.usedProxy ? `<div class="mini" style="margin-top:6px;color:#9aa4b2">Corners/Cards are proxies (add corners/cards fields in xg_tables.json to upgrade)</div>` : ""}
  `;

  const h2hObj = readLastH2H(league, home, away);
  els.h2hText.textContent = formatH2H(h2hObj);
}

function renderFixturesTable(league){
  const list = state.fixtures.filter(f => (f.league || f.League || "") === league);
  els.fixturesMeta.textContent = `${league} • ${list.length} fixture(s)`;

  if (!list.length){
    els.fixturesBody.innerHTML = `<tr><td colspan="9" class="k">No fixtures found for this league in fixtures.json</td></tr>`;
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

    // PRO metrics
    const pro = predictCornersCards({ league: comp, home, away, meanGoals: r.meanGoals });
    const { main, separation } = pickMainMarket(r);

    // Optional odds fields from fixtures.json:
    // You can store them like:
    // f.odds_home, f.odds_draw, f.odds_away (decimal)
    // Or nested f.odds = { home, draw, away }
    const oddsHome = Number(f.odds_home ?? f.odds?.home);
    const oddsDraw = Number(f.odds_draw ?? f.odds?.draw);
    const oddsAway = Number(f.odds_away ?? f.odds?.away);

    let oddsForMain = null;
    if (main.key === "H") oddsForMain = oddsHome;
    if (main.key === "D") oddsForMain = oddsDraw;
    if (main.key === "A") oddsForMain = oddsAway;

    const pModel = main.p; // 0-1
    const ev = evFlag({ pModel, oddsDecimal: oddsForMain });
    const conf = confidenceTag({ pMain: pModel, separation, edge: ev.edge });

    const ouText = (r.pOver25 >= 55) ? `Over ${r.pOver25}%`
                 : (r.pUnder25 >= 55) ? `Under ${r.pUnder25}%`
                 : `Lean O${r.pOver25}%`;

    const bttsText = (r.pBTTS >= 55) ? `Yes ${r.pBTTS}%` : `Yes ${r.pBTTS}%`;

    const ahText = `H ${r.ahLean.line >= 0 ? "+" : ""}${r.ahLean.line.toFixed(2)} (${r.ahLean.pCover}%)`;

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
        <td class="k">${ouText}<div class="mini">μG ${r.meanGoals}</div></td>
        <td class="k">${bttsText}</td>
        <td class="k">${ahText}</td>
        <td class="k">C ${pro.corners} • K ${pro.cards}</td>
        <td class="k">${escapeHtml(ev.flag)}<div class="mini">${conf}</div></td>
      </tr>
    `;
  }

  els.fixturesBody.innerHTML = html || `<tr><td colspan="9" class="k">No usable fixtures (missing home/away names)</td></tr>`;

  // tap row -> fill single predictor
  for (const tr of els.fixturesBody.querySelectorAll("tr[data-home]")){
    tr.addEventListener("click", () => {
      const comp = tr.getAttribute("data-league");
      const home = tr.getAttribute("data-home");
      const away = tr.getAttribute("data-away");

      els.leagueSelect.value = comp;
      onLeagueChange();

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

  // include fixture-only teams
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
    for (const l of state.leagues) addOption(els.leagueSelect, l, l);

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

  const fixN = state.fixtures.length;
  let xgTeams = 0;
  for (const l of Object.keys(state.xg || {})) xgTeams += Object.keys(state.xg[l] || {}).length;

  const lfExample = state.leagues.length ? (state.leagueFactor.get(state.leagues[0]) ?? 1.00) : 1.00;
  els.statusLine.textContent = `Loaded. Fixtures: ${fixN} | Teams with xG: ${xgTeams} | League factor example: ${lfExample.toFixed(2)} | PRO: BTTS/AH/Corners/Cards/EV`;

  const ok = state.ready.xg && state.ready.fix;
  els.leagueSelect.disabled = !ok;

  if (!state.leagues.length && state.fixtures.length){
    const leagues = sortAlpha(uniq(state.fixtures.map(f => f.league || f.League || "").filter(Boolean)));
    state.leagues = leagues;
    clearOptions(els.leagueSelect, true);
    for (const l of leagues) addOption(els.leagueSelect, l, l);
  }

  if (state.leagues.length === 1){
    els.leagueSelect.value = state.leagues[0];
    onLeagueChange();
  }

  if (!ok){
    els.fixturesBody.innerHTML = `<tr><td colspan="9" class="k">Missing required files. Need xg_tables.json + fixtures.json</td></tr>`;
  }
}

boot();
