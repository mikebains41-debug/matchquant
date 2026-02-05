// =====================================================
// MatchQuant - single file app logic
// Schema expected in xg_tables.json per team:
// { "xg_for": number, "xg_against": number }
// =====================================================

let xgTables = {};
let fixtures = [];
let h2h = [];
let PRO = false;

// ------------ helpers ------------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const keyPair = (league, home, away) =>
  `${String(league).trim()}|${String(home).trim()}|${String(away).trim()}`;

function togglePro() {
  PRO = !PRO;
  document.getElementById("paywall").style.display = PRO ? "block" : "none";
  // later: enforce PRO checks here (Stripe login etc.)
}

// ------------ load xG ------------
fetch("xg_tables.json")
  .then(res => res.json())
  .then(data => {
    xgTables = data;
    populateLeagues();
    document.getElementById("xg-status").innerText =
      `✓ xG loaded (${Object.keys(xgTables).length} leagues)`;
  })
  .catch(err => {
    alert("Failed to load xg_tables.json");
    console.error(err);
    document.getElementById("xg-status").innerText = "✗ xG failed";
  });

// ------------ load fixtures ------------
fetch("fixtures.json")
  .then(res => res.json())
  .then(data => {
    fixtures = Array.isArray(data) ? data : [];
    document.getElementById("fx-status").innerText =
      `✓ fixtures loaded (${fixtures.length})`;
    refreshTodayFixtures();
  })
  .catch(err => {
    console.error(err);
    document.getElementById("fx-status").innerText = "⚠ fixtures missing";
  });

// ------------ load H2H ------------
fetch("h2h.json")
  .then(res => res.json())
  .then(data => {
    h2h = Array.isArray(data) ? data : [];
    document.getElementById("h2h-status").innerText =
      `✓ H2H loaded (${h2h.length})`;
  })
  .catch(err => {
    console.error(err);
    document.getElementById("h2h-status").innerText = "⚠ H2H missing";
  });

// =====================================================
// UI
// =====================================================
function populateLeagues() {
  const leagueSelect = document.getElementById("league");
  leagueSelect.innerHTML = `<option value="">Select a league...</option>`;

  Object.keys(xgTables).forEach(league => {
    const opt = document.createElement("option");
    opt.value = league;
    opt.textContent = league;
    leagueSelect.appendChild(opt);
  });

  leagueSelect.onchange = () => {
    populateTeams();
    populateFixtureDropdown();
    refreshTodayFixtures();
    refreshH2H();
  };

  document.getElementById("fixture").onchange = () => {
    const val = document.getElementById("fixture").value;
    if (!val) return;
    const [league, home, away] = val.split("|");
    document.getElementById("league").value = league;
    populateTeams();
    document.getElementById("home").value = home;
    document.getElementById("away").value = away;
    refreshTodayFixtures();
    refreshH2H();
  };

  document.getElementById("home").onchange = refreshH2H;
  document.getElementById("away").onchange = refreshH2H;
}

function populateTeams() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home");
  const away = document.getElementById("away");

  home.innerHTML = `<option value="">Select home team...</option>`;
  away.innerHTML = `<option value="">Select away team...</option>`;

  if (!league || !xgTables[league]) return;

  const teams = Object.keys(xgTables[league]).sort((a, b) => a.localeCompare(b));
  teams.forEach(team => {
    const h = document.createElement("option");
    h.value = team;
    h.textContent = team;
    home.appendChild(h);

    const a = document.createElement("option");
    a.value = team;
    a.textContent = team;
    away.appendChild(a);
  });
}

function populateFixtureDropdown() {
  const league = document.getElementById("league").value;
  const fx = document.getElementById("fixture");
  fx.innerHTML = `<option value="">Select a fixture…</option>`;

  if (!league) return;

  const today = isoToday();
  const list = fixtures
    .filter(f => f.league === league && String(f.date) === today)
    .slice(0, 40);

  list.forEach(f => {
    const opt = document.createElement("option");
    opt.value = `${f.league}|${f.home}|${f.away}`;
    opt.textContent = `${f.home} vs ${f.away} (${f.date})`;
    fx.appendChild(opt);
  });
}

function isoToday() {
  // uses device local date
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function refreshTodayFixtures() {
  const league = document.getElementById("league").value;
  const box = document.getElementById("today");
  if (!league) { box.innerHTML = "—"; return; }

  const today = isoToday();
  const list = fixtures.filter(f => f.league === league && String(f.date) === today);

  if (!list.length) {
    box.innerHTML = `No fixtures for <b>${league}</b> on <span class="mono">${today}</span>.`;
    return;
  }

  box.innerHTML =
    `<b>${league}</b> <span class="mono">${today}</span><ul class="list">` +
    list.slice(0, 25).map(f => `<li>${f.home} vs ${f.away}</li>`).join("") +
    `</ul>`;
}

function refreshH2H() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home").value;
  const away = document.getElementById("away").value;
  const box = document.getElementById("h2h");

  if (!league || !home || !away) { box.innerHTML = "—"; return; }

  const a = keyPair(league, home, away);
  const b = keyPair(league, away, home);

  const match = h2h.find(x => keyPair(x.league, x.home, x.away) === a)
             || h2h.find(x => keyPair(x.league, x.home, x.away) === b);

  if (!match) {
    box.innerHTML = `No H2H entry found for <b>${home}</b> vs <b>${away}</b> in <b>${league}</b>.`;
    return;
  }

  // Normalize display in selected orientation
  const flipped = keyPair(match.league, match.home, match.away) === b;
  const homeTeam = flipped ? away : home;
  const awayTeam = flipped ? home : away;

  // If stored was opposite, flip score
  const hs = flipped ? match.away_goals : match.home_goals;
  const as = flipped ? match.home_goals : match.away_goals;

  box.innerHTML = `
    <div><b>${homeTeam}</b> ${hs} – ${as} <b>${awayTeam}</b></div>
    <div class="muted">Cards: <b>${match.cards}</b> · Corners: <b>${match.corners}</b> · Date: <span class="mono">${match.date || "—"}</span></div>
  `;
}

// =====================================================
// Monte Carlo core
// =====================================================
function poisson(lambda) {
  // Knuth algorithm
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function runMonteCarlo(homeLam, awayLam, sims) {
  const maxGoals = 7; // bucket 7+ together
  const scoreCounts = new Map();
  let homeWin = 0, draw = 0, awayWin = 0;
  let over25 = 0, btts = 0;
  let totalGoalsSum = 0;

  for (let i = 0; i < sims; i++) {
    const hg = poisson(homeLam);
    const ag = poisson(awayLam);

    const hh = Math.min(hg, maxGoals);
    const aa = Math.min(ag, maxGoals);
    const key = `${hh}-${aa}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);

    if (hg > ag) homeWin++;
    else if (hg === ag) draw++;
    else awayWin++;

    if (hg + ag > 2.5) over25++;
    if (hg > 0 && ag > 0) btts++;

    totalGoalsSum += (hg + ag);
  }

  // Top 5 most common scorelines
  const top = [...scoreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => ({ score: k.replace("7-","7+ - ").replace("-7"," - 7+"), pct: (v / sims) * 100 }));

  return {
    homeWinPct: (homeWin / sims) * 100,
    drawPct: (draw / sims) * 100,
    awayWinPct: (awayWin / sims) * 100,
    over25Pct: (over25 / sims) * 100,
    bttsPct: (btts / sims) * 100,
    avgTotal: totalGoalsSum / sims,
    topScores: top
  };
}

// =====================================================
// Prediction (uses xg_for/xg_against)
// =====================================================
function runPrediction() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home").value;
  const away = document.getElementById("away").value;

  if (!league || !home || !away) {
    alert("Select league, home team, and away team");
    return;
  }

  const H = xgTables?.[league]?.[home];
  const A = xgTables?.[league]?.[away];

  if (!H || !A) {
    alert(`Team not found in xG table for league "${league}". Make sure the team exists in xg_tables.json.`);
    return;
  }

  // strict schema
  if (typeof H.xg_for !== "number" || typeof H.xg_against !== "number"
   || typeof A.xg_for !== "number" || typeof A.xg_against !== "number") {
    alert(`Your xg_tables.json team entries must be numbers: xg_for and xg_against.`);
    return;
  }

  // expected goals (simple blend)
  const homeLam = clamp((H.xg_for + A.xg_against) / 2, 0.15, 4.5);
  const awayLam = clamp((A.xg_for + H.xg_against) / 2, 0.15, 4.5);
  const totalLam = homeLam + awayLam;

  const sims = Math.max(1000, Number(document.getElementById("sims").value || 10000));

  const mc = runMonteCarlo(homeLam, awayLam, sims);

  // EV flags (simple)
  let ev = "🟡 Neutral";
  if (totalLam > 2.75) ev = "🟢 Over Lean";
  if (totalLam < 2.20) ev = "🔴 Under Lean";

  // “Most likely” from Monte Carlo top scoreline
  const mostLikely = mc.topScores?.[0]?.score?.replace("7+ - ", "7+–").replace(" - 7+", "–7+")
                    || `${Math.round(homeLam)}-${Math.round(awayLam)}`;

  const out = document.getElementById("output");
  out.innerHTML = `
    <div><b>${home}</b> vs <b>${away}</b> <span class="muted">(${league})</span></div>
    <div class="muted">Lambdas: <span class="mono">${homeLam.toFixed(2)}</span> – <span class="mono">${awayLam.toFixed(2)}</span> · Total <span class="mono">${totalLam.toFixed(2)}</span></div>
    <div style="margin-top:8px;"><b>Most likely score:</b> ${mostLikely}</div>
    <div class="muted">1X2: Home <b>${mc.homeWinPct.toFixed(1)}%</b> · Draw <b>${mc.drawPct.toFixed(1)}%</b> · Away <b>${mc.awayWinPct.toFixed(1)}%</b></div>
    <div class="muted">O2.5: <b>${mc.over25Pct.toFixed(1)}%</b> · BTTS: <b>${mc.bttsPct.toFixed(1)}%</b> · Avg total goals: <b>${mc.avgTotal.toFixed(2)}</b></div>
    <div class="muted"><b>EV:</b> ${ev}</div>
    <div style="margin-top:10px;" class="muted"><b>Top scorelines:</b>
      <ul class="list">
        ${mc.topScores.map(s => `<li>${s.score} (${s.pct.toFixed(1)}%)</li>`).join("")}
      </ul>
    </div>
  `;

  // update panels
  refreshH2H();
  refreshTodayFixtures();
}
