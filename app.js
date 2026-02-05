// MatchQuant (mobile-safe) - leagues + fixtures + team dropdowns + run prediction
// Works with xg_tables.json that uses either:
//   {att, def}  OR  {xg, xga}  OR  {xg_for, xg_against}  OR  {xgf, xga}

let xgTables = {};     // normalized: { League: { Team: {att, def} } }
let fixtures = [];     // [{date, league, home, away}]
let h2h = [];          // optional array

const $ = (id) => document.getElementById(id);

function cleanName(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Makes team lookup forgiving: case/spacing
function keyName(s) {
  return cleanName(s).toLowerCase();
}

function normalizeXgTables(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") throw new Error("xg_tables.json is not an object");

  for (const leagueRaw of Object.keys(raw)) {
    const league = cleanName(leagueRaw);
    const teamsObj = raw[leagueRaw];
    if (!teamsObj || typeof teamsObj !== "object") continue;

    out[league] = {};

    for (const teamRaw of Object.keys(teamsObj)) {
      const team = cleanName(teamRaw);
      const t = teamsObj[teamRaw] || {};

      // Accept multiple field naming styles
      const att =
        (t.att ?? t.attack ?? t.xg ?? t.xgf ?? t.xg_for ?? t.xG_for ?? t.xG ?? null);
      const def =
        (t.def ?? t.defense ?? t.xga ?? t.xg_against ?? t.xG_against ?? t.xGA ?? null);

      const attNum = Number(att);
      const defNum = Number(def);

      if (Number.isFinite(attNum) && Number.isFinite(defNum)) {
        out[league][team] = { att: attNum, def: defNum };
      }
    }

    // If league ended up empty, remove it
    if (Object.keys(out[league]).length === 0) delete out[league];
  }

  if (Object.keys(out).length === 0) {
    throw new Error("No valid xG data found (need att/def or xg/xga or xg_for/xg_against).");
  }
  return out;
}

function populateLeagueDropdown() {
  const leagueSel = $("league");
  leagueSel.innerHTML = `<option value="">Select a league...</option>`;

  Object.keys(xgTables)
    .sort()
    .forEach((lg) => {
      const opt = document.createElement("option");
      opt.value = lg;
      opt.textContent = lg;
      leagueSel.appendChild(opt);
    });

  leagueSel.onchange = () => {
    populateFixtureDropdown();
    populateTeamDropdowns();
  };
}

function populateTeamDropdowns() {
  const league = $("league").value;
  const homeSel = $("home");
  const awaySel = $("away");

  homeSel.innerHTML = `<option value="">Select home team...</option>`;
  awaySel.innerHTML = `<option value="">Select away team...</option>`;

  if (!league || !xgTables[league]) return;

  const teams = Object.keys(xgTables[league]).sort();
  teams.forEach((team) => {
    const o1 = document.createElement("option");
    o1.value = team;
    o1.textContent = team;
    homeSel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = team;
    o2.textContent = team;
    awaySel.appendChild(o2);
  });
}

function populateFixtureDropdown() {
  const league = $("league").value;
  const fixSel = $("fixture");
  if (!fixSel) return;

  fixSel.innerHTML = `<option value="">Select a fixture...</option>`;
  if (!league) return;

  // Show fixtures for selected league only
  const list = fixtures
    .filter((f) => cleanName(f.league) === league)
    .slice(0, 200);

  list.forEach((f, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${f.date || ""} — ${f.home} vs ${f.away}`;
    opt.dataset.home = f.home;
    opt.dataset.away = f.away;
    fixSel.appendChild(opt);
  });

  // Auto-fill teams when fixture picked
  fixSel.onchange = () => {
    const chosen = fixSel.options[fixSel.selectedIndex];
    if (!chosen || !chosen.dataset.home) return;

    // Force correct league teams to be loaded
    populateTeamDropdowns();

    // Try exact match first
    $("home").value = chosen.dataset.home;
    $("away").value = chosen.dataset.away;

    // If not exact, try forgiving match
    if (!$("home").value) $("home").value = findClosestTeam($("league").value, chosen.dataset.home);
    if (!$("away").value) $("away").value = findClosestTeam($("league").value, chosen.dataset.away);
  };
}

function findClosestTeam(league, name) {
  const target = keyName(name);
  const teams = Object.keys(xgTables[league] || {});
  // exact keyName match
  const found = teams.find((t) => keyName(t) === target);
  return found || "";
}

function poissonSample(lambda) {
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

function runMonteCarlo(homeLam, awayLam, sims) {
  const maxGoals = 8;
  const scoreCounts = new Map();
  let homeW = 0, draw = 0, awayW = 0;
  let over25 = 0, btts = 0;

  for (let i = 0; i < sims; i++) {
    const hg = Math.min(poissonSample(homeLam), maxGoals);
    const ag = Math.min(poissonSample(awayLam), maxGoals);

    const key = `${hg}-${ag}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);

    if (hg > ag) homeW++;
    else if (hg === ag) draw++;
    else awayW++;

    if (hg + ag >= 3) over25++;
    if (hg >= 1 && ag >= 1) btts++;
  }

  const topScores = [...scoreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, c]) => ({ score: k, pct: (c / sims) * 100 }));

  return {
    homeWinPct: (homeW / sims) * 100,
    drawPct: (draw / sims) * 100,
    awayWinPct: (awayW / sims) * 100,
    over25Pct: (over25 / sims) * 100,
    bttsPct: (btts / sims) * 100,
    topScores
  };
}

function setOutput(html) {
  const out = $("output");
  if (out) out.innerHTML = html;
}

function runPrediction() {
  const league = $("league").value;
  const home = $("home").value;
  const away = $("away").value;

  if (!league) return alert("Select a league first.");
  if (!home || !away) return alert("Select home + away teams.");

  const H = xgTables[league]?.[home];
  const A = xgTables[league]?.[away];

  if (!H) return alert(`Home team not found in xG table: "${home}"`);
  if (!A) return alert(`Away team not found in xG table: "${away}"`);

  // Simple lambda blend
  const homeLam = (H.att + A.def) / 2;
  const awayLam = (A.att + H.def) / 2;

  const sims = Math.max(1000, Math.min(50000, Number($("sims")?.value || 10000) || 10000));
  const mc = runMonteCarlo(homeLam, awayLam, sims);

  // EV flag (very basic)
  const totalExp = homeLam + awayLam;
  let ev = "🟡 Neutral";
  if (totalExp >= 2.85) ev = "🟢 Over Lean";
  if (totalExp <= 2.15) ev = "🔴 Under Lean";

  const top = mc.topScores.map(s => `<li>${s.score} (${s.pct.toFixed(1)}%)</li>`).join("");

  setOutput(`
    <h3>Prediction</h3>
    <p><strong>${home}</strong> vs <strong>${away}</strong></p>
    <p>Expected Goals (λ): <strong>${homeLam.toFixed(2)}</strong> – <strong>${awayLam.toFixed(2)}</strong></p>
    <p>1X2: <strong>Home ${mc.homeWinPct.toFixed(1)}%</strong> | <strong>Draw ${mc.drawPct.toFixed(1)}%</strong> | <strong>Away ${mc.awayWinPct.toFixed(1)}%</strong></p>
    <p>O/U 2.5: <strong>Over ${mc.over25Pct.toFixed(1)}%</strong> | <strong>Under ${(100 - mc.over25Pct).toFixed(1)}%</strong></p>
    <p>BTTS: <strong>${mc.bttsPct.toFixed(1)}%</strong></p>
    <p><strong>EV:</strong> ${ev}</p>
    <p><strong>Top scorelines:</strong></p>
    <ul>${top}</ul>
    <p style="opacity:.7">Sims: ${sims.toLocaleString()}</p>
  `);
}

// ---- LOAD ALL DATA ----
Promise.all([
  fetch("xg_tables.json").then(r => r.json()),
  fetch("fixtures.json").then(r => r.json()).catch(() => []),
  fetch("h2h.json").then(r => r.json()).catch(() => [])
])
  .then(([xgRaw, fixturesRaw, h2hRaw]) => {
    xgTables = normalizeXgTables(xgRaw);

    fixtures = Array.isArray(fixturesRaw) ? fixturesRaw : (fixturesRaw.fixtures || []);
    h2h = Array.isArray(h2hRaw) ? h2hRaw : (h2hRaw.matches || []);

    $("status").textContent = `✓ xG loaded (${Object.keys(xgTables).length} leagues)`;

    const fcount = fixtures.length || 0;
    const hcount = h2h.length || 0;

    const fEl = $("fixturesStatus");
    if (fEl) fEl.textContent = `✓ fixtures loaded (${fcount})`;
    const hEl = $("h2hStatus");
    if (hEl) hEl.textContent = `✓ H2H loaded (${hcount})`;

    populateLeagueDropdown();
    populateFixtureDropdown();
    populateTeamDropdowns();

    // Wire the button safely (important!)
    const btn = $("run");
    if (btn) btn.onclick = runPrediction;
  })
  .catch((err) => {
    alert("Failed to load data. Check xg_tables.json format & file names.");
    console.error(err);
  });
