let xgTables = {};

// ---------- LOAD XG TABLES ----------
fetch("xg_tables.json")
  .then(res => res.json())
  .then(data => {
    xgTables = normalizeAllLeagues(data);
    populateLeagueDropdown();
    document.getElementById("xg-status").innerText =
      `✓ xG loaded (${Object.keys(xgTables).length} leagues)`;
  })
  .catch(err => {
    alert("Failed to load xg_tables.json");
    console.error(err);
  });

// ---------- NORMALIZATION ----------
function normalizeAllLeagues(raw) {
  const out = {};

  for (const league in raw) {
    out[league] = {};

    for (const team in raw[league]) {
      const t = raw[league][team];

      const att =
        t.att ??
        t.xg ??
        t.xg_for ??
        t.xgf ??
        null;

      const def =
        t.def ??
        t.xga ??
        t.xg_against ??
        t.xga ??
        null;

      if (isFinite(att) && isFinite(def)) {
        out[league][team] = {
          att: Number(att),
          def: Number(def)
        };
      }
    }

    if (Object.keys(out[league]).length === 0) {
      delete out[league];
    }
  }

  if (Object.keys(out).length === 0) {
    throw new Error("No valid xG data found");
  }

  return out;
}

// ---------- UI ----------
function populateLeagueDropdown() {
  const leagueSelect = document.getElementById("league");
  leagueSelect.innerHTML = `<option value="">Select a league...</option>`;

  Object.keys(xgTables).forEach(league => {
    const opt = document.createElement("option");
    opt.value = league;
    opt.textContent = league;
    leagueSelect.appendChild(opt);
  });

  leagueSelect.onchange = populateTeams;
}

function populateTeams() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home");
  const away = document.getElementById("away");

  home.innerHTML = `<option value="">Select home team...</option>`;
  away.innerHTML = `<option value="">Select away team...</option>`;

  if (!league || !xgTables[league]) return;

  Object.keys(xgTables[league]).forEach(team => {
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

// ---------- PREDICTION ----------
function runPrediction() {
  const league = document.getElementById("league").value;
  const home = document.getElementById("home").value;
  const away = document.getElementById("away").value;

  if (!league || !home || !away) {
    alert("Select league, home team, and away team");
    return;
  }

  const H = xgTables[league][home];
  const A = xgTables[league][away];

  if (!H || !A) {
    alert("Team not found in xG table");
    return;
  }

  const homeXG = (H.att + A.def) / 2;
  const awayXG = (A.att + H.def) / 2;

  const score = `${Math.round(homeXG)} – ${Math.round(awayXG)}`;
  const total = homeXG + awayXG;

  let ev = "🟡 Neutral";
  if (total > 2.7) ev = "🟢 Over Lean";
  if (total < 2.2) ev = "🔴 Under Lean";

  document.getElementById("output").innerHTML = `
    <h3>Prediction</h3>
    <p><strong>${home}</strong> vs <strong>${away}</strong></p>
    <p>Expected Goals: ${homeXG.toFixed(2)} – ${awayXG.toFixed(2)}</p>
    <p><strong>Score:</strong> ${score}</p>
    <p><strong>Total:</strong> ${total.toFixed(2)}</p>
    <p><strong>EV:</strong> ${ev}</p>
  `;
}
