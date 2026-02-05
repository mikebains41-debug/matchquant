let xgTables = {};
let fixtures = [];
let h2h = [];

// ---------- LOAD DATA ----------
Promise.all([
  fetch("xg_tables.json").then(r => r.json()),
  fetch("fixtures.json").then(r => r.json()).catch(() => []),
  fetch("h2h.json").then(r => r.json()).catch(() => [])
])
  .then(([xg, fx, hh]) => {
    xgTables = xg || {};
    fixtures = Array.isArray(fx) ? fx : (fx.fixtures || []);
    h2h = Array.isArray(hh) ? hh : (hh.h2h || []);

    setPill("xg-status", `✓ xG loaded (${Object.keys(xgTables).length} leagues)`);
    setPill("fx-status", `✓ fixtures loaded (${fixtures.length})`);
    setPill("h2h-status", `✓ H2H loaded (${h2h.length})`);

    populateLeagueDropdown();
    populateFixtureDropdown(); // optional
  })
  .catch(err => {
    alert("Failed to load data files. Check JSON + filenames.");
    console.error(err);
  });

function setPill(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ---------- UI ----------
function populateLeagueDropdown() {
  const leagueSelect = document.getElementById("league");
  leagueSelect.innerHTML = `<option value="">Select a league...</option>`;

  Object.keys(xgTables)
    .sort((a, b) => a.localeCompare(b))
    .forEach(league => {
      const opt = document.createElement("option");
      opt.value = league;
      opt.textContent = league;
      leagueSelect.appendChild(opt);
    });

  leagueSelect.onchange = () => {
    populateTeamsFromLeague();
    populateFixtureDropdown();
    clearOutput();
  };

  // initial fill if only 1 league
  if (Object.keys(xgTables).length === 1) {
    leagueSelect.value = Object.keys(xgTables)[0];
    populateTeamsFromLeague();
    populateFixtureDropdown();
  }
}

function populateTeamsFromLeague() {
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
  const fxSelect = document.getElementById("fixture");
  if (!fxSelect) return;

  fxSelect.innerHTML = `<option value="">Select a fixture...</option>`;

  if (!league) return;

  // allow either format: {league, home, away, date} OR {League, Home, Away, Date}
  const list = fixtures
    .filter(f => (f.league || f.League) === league)
    .map(f => ({
      league,
      home: f.home || f.Home,
      away: f.away || f.Away,
      date: f.date || f.Date || ""
    }))
    .filter(f => f.home && f.away);

  list.forEach((f, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${f.home} vs ${f.away}${f.date ? ` (${f.date})` : ""}`;
    opt.dataset.home = f.home;
    opt.dataset.away = f.away;
    fxSelect.appendChild(opt);
  });

  fxSelect.onchange = () => {
    const sel = fxSelect.options[fxSelect.selectedIndex];
    if (!sel || !sel.dataset.home) return;
    document.getElementById("home").value = sel.dataset.home;
    document.getElementById("away").value = sel.dataset.away;
    clearOutput();
  };
}

function clearOutput() {
  const out = document.getElementById("output");
  if (out) out.innerHTML = `<div class="muted">Choose league + teams, then Run.</div>`;
  const h2hBox = document.getElementById("h2h");
  if (h2hBox) h2hBox.textContent = "";
}

// ---------- MODEL ----------
function poisson(rng, lambda) {
  // Knuth algorithm
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function makeRng(seed) {
  // simple seeded RNG
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clampSims(n) {
  if (!Number.isFinite(n)) return 10000;
  return Math.max(1000, Math.min(200000, Math.floor(n)));
}

// ---------- RUN ----------
function runPrediction() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home").value;
  const away = document.getElementById("away").value;

  const simsInput = document.getElementById("sims");
  const sims = clampSims(Number(simsInput ? simsInput.value : 10000));

  if (!league || !home || !away) {
    alert("Select league, home team, and away team.");
    return;
  }
  if (home === away) {
    alert("Home and away cannot be the same team.");
    return;
  }

  const H = xgTables?.[league]?.[home];
  const A = xgTables?.[league]?.[away];

  if (!H || !A) {
    alert("Team not found in xg_tables.json for this league.");
    return;
  }

  // Expected goals (simple blend)
  const homeLambda = (Number(H.att) + Number(A.def)) / 2;
  const awayLambda = (Number(A.att) + Number(H.def)) / 2;

  const rng = makeRng(Date.now() & 0xffffffff);

  let homeWins = 0, draws = 0, awayWins = 0;
  let over25 = 0, btts = 0;
  let sumH = 0, sumA = 0;

  const scoreCounts = new Map();

  for (let i = 0; i < sims; i++) {
    const hg = poisson(rng, homeLambda);
    const ag = poisson(rng, awayLambda);

    sumH += hg;
    sumA += ag;

    if (hg > ag) homeWins++;
    else if (hg === ag) draws++;
    else awayWins++;

    if (hg + ag >= 3) over25++;
    if (hg >= 1 && ag >= 1) btts++;

    const key = `${hg}-${ag}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);
  }

  let bestScore = "";
  let bestCount = -1;
  for (const [k, v] of scoreCounts.entries()) {
    if (v > bestCount) {
      bestCount = v;
      bestScore = k;
    }
  }

  const pHome = Math.round((homeWins / sims) * 100);
  const pDraw = Math.round((draws / sims) * 100);
  const pAway = Math.round((awayWins / sims) * 100);
  const pO25 = Math.round((over25 / sims) * 100);
  const pBTTS = Math.round((btts / sims) * 100);

  const avgH = (sumH / sims).toFixed(2);
  const avgA = (sumA / sims).toFixed(2);

  // H2H lookup (optional)
  const h2hBox = document.getElementById("h2h");
  if (h2hBox) {
    const found = h2h.find(x =>
      ((x.home === home && x.away === away) || (x.home === away && x.away === home)) &&
      (x.league === league || !x.league)
    );
    h2hBox.textContent = found
      ? `${found.home} ${found.home_goals}-${found.away_goals} ${found.away} | Cards: ${found.cards ?? "?"} | Corners: ${found.corners ?? "?"}`
      : "No H2H found for this matchup (in h2h.json).";
  }

  document.getElementById("output").innerHTML = `
    <div class="mono">
      <div><b>${league}</b></div>
      <div><b>${home}</b> vs <b>${away}</b></div>
      <hr/>
      <div>λ Home: ${homeLambda.toFixed(2)} | λ Away: ${awayLambda.toFixed(2)}</div>
      <div>Avg goals: ${avgH} - ${avgA} (sims: ${sims})</div>
      <div>Most likely score: <b>${bestScore}</b></div>
      <hr/>
      <div>1X2: Home ${pHome}% | Draw ${pDraw}% | Away ${pAway}%</div>
      <div>O2.5: ${pO25}% | BTTS: ${pBTTS}%</div>
    </div>
  `;
}

// expose for onclick
window.runPrediction = runPrediction;
