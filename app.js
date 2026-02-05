/* MatchQuant — app.js (FULL REPLACE)
   Loads: fixtures.json, xg_tables.json, h2h.json
   Adds: O/U probabilities, AH, corners, cards, pro grade, fixtures table
*/

let XG = {};
let FIX = [];
let H2H = {};

const $ = (id) => document.getElementById(id);

function setPill(id, ok, text) {
  const el = $(id);
  if (!el) return;
  el.className = "pill " + (ok ? "ok" : "bad");
  el.textContent = text;
}

async function loadJSON(path) {
  const res = await fetch(path + `?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return await res.json();
}

function poisson(lambda) {
  let L = Math.exp(-lambda);
  let p = 1.0;
  let k = 0;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function mostLikelyScore(scoreMap) {
  let best = null;
  let bestCt = -1;
  for (const k in scoreMap) {
    if (scoreMap[k] > bestCt) { bestCt = scoreMap[k]; best = k; }
  }
  return best || "0-0";
}

function simulateMatch({ homeTeam, awayTeam, league, sims, homeAdv, baseGoals, maxGoalsCap }) {
  const home = XG?.[league]?.[homeTeam];
  const away = XG?.[league]?.[awayTeam];
  if (!home || !away) {
    return { error: `Missing team in xg_tables.json: ${league} / ${homeTeam} or ${awayTeam}` };
  }

  const hAtt = Number(home.att ?? 1.0);
  const hDef = Number(home.def ?? 1.0);
  const aAtt = Number(away.att ?? 1.0);
  const aDef = Number(away.def ?? 1.0);

  // λ goals (your core model)
  const lambdaHome = baseGoals * hAtt * aDef * homeAdv;
  const lambdaAway = baseGoals * aAtt * hDef;

  // Optional real corners/cards fields (if you later add them per team)
  const hCorners = home.corners ?? null;
  const aCorners = away.corners ?? null;
  const hCards = home.cards ?? null;
  const aCards = away.cards ?? null;

  // Proxies if fields not present
  const cornersProxy = +(8.3 + (lambdaHome + lambdaAway)).toFixed(2);
  const cardsProxy = +(3.4 + Math.abs(lambdaHome - lambdaAway)).toFixed(2);

  const cornersPred = (hCorners != null && aCorners != null)
    ? +(((Number(hCorners) + Number(aCorners)) / 2).toFixed(2))
    : cornersProxy;

  const cardsPred = (hCards != null && aCards != null)
    ? +(((Number(hCards) + Number(aCards)) / 2).toFixed(2))
    : cardsProxy;

  let hW = 0, dW = 0, aW = 0;
  let over25 = 0, over35 = 0, under25 = 0, under35 = 0, btts = 0;
  let scoreMap = {};
  let ahCoverHome075 = 0; // Home -0.75 cover proxy

  const cap = Math.max(4, Number(maxGoalsCap || 8));

  for (let i = 0; i < sims; i++) {
    const hg = clamp(poisson(lambdaHome), 0, cap);
    const ag = clamp(poisson(lambdaAway), 0, cap);

    const key = `${hg}-${ag}`;
    scoreMap[key] = (scoreMap[key] || 0) + 1;

    if (hg > ag) hW++; else if (hg === ag) dW++; else aW++;

    const tot = hg + ag;
    if (tot > 2.5) over25++; else under25++;
    if (tot > 3.5) over35++; else under35++;
    if (hg > 0 && ag > 0) btts++;

    // AH -0.75 cover proxy: win by 2+ = full, win by 1 = half-ish
    if (hg - ag >= 2) ahCoverHome075++;
    else if (hg - ag === 1) ahCoverHome075 += 0.5;
  }

  const pH = hW / sims;
  const pD = dW / sims;
  const pA = aW / sims;

  const probs = {
    H: +(pH * 100).toFixed(1),
    D: +(pD * 100).toFixed(1),
    A: +(pA * 100).toFixed(1),
  };

  const totals = {
    over25: +((over25 / sims) * 100).toFixed(1),
    under25: +((under25 / sims) * 100).toFixed(1),
    over35: +((over35 / sims) * 100).toFixed(1),
    under35: +((under35 / sims) * 100).toFixed(1),
    bttsYes: +((btts / sims) * 100).toFixed(1),
  };

  const ahLean = (lambdaHome - lambdaAway); // positive = home lean

  // Convert AH lean into a readable line suggestion (simple ladder)
  let ahLine = "0";
  if (ahLean >= 1.0) ahLine = "Home -0.75";
  else if (ahLean >= 0.6) ahLine = "Home -0.5";
  else if (ahLean >= 0.25) ahLine = "Home -0.25";
  else if (ahLean <= -1.0) ahLine = "Away -0.75";
  else if (ahLean <= -0.6) ahLine = "Away -0.5";
  else if (ahLean <= -0.25) ahLine = "Away -0.25";
  else ahLine = "0 (tight)";

  const ahCover = +((ahCoverHome075 / sims) * 100).toFixed(1);

  // Pro grade (simple + useful): based on strongest market signal
  const maxP = Math.max(pH, pD, pA);
  const grade =
    maxP >= 0.62 ? "A" :
    maxP >= 0.54 ? "B" : "C";

  return {
    lambdaHome: +lambdaHome.toFixed(2),
    lambdaAway: +lambdaAway.toFixed(2),
    score: mostLikelyScore(scoreMap),
    probs,
    totals,
    ah: {
      lean: +ahLean.toFixed(2),
      line: ahLine,
      coverPct: ahLine.includes("Home -0.75") ? ahCover : null
    },
    corners: cornersPred,
    cards: cardsPred,
    grade
  };
}

function normalizeLeagueName(s) {
  return (s || "").trim();
}

function fixtureKey(f) {
  return `${(f.league||"").toLowerCase()}__${(f.home||"").toLowerCase()}__${(f.away||"").toLowerCase()}`;
}

function h2hLookup(league, home, away) {
  const key1 = `${league}__${home}__${away}`;
  const key2 = `${league}__${away}__${home}`;
  return H2H[key1] || H2H[key2] || null;
}

function populateLeagues() {
  const leagues = Object.keys(XG || {}).sort();
  const sel = $("leagueSelect");
  sel.innerHTML = `<option value="">Select League</option>` + leagues.map(l => `<option value="${l}">${l}</option>`).join("");
}

function populateTeams(league) {
  const teams = Object.keys(XG?.[league] || {}).sort();
  $("homeSelect").innerHTML = `<option value="">Select home team</option>` + teams.map(t => `<option value="${t}">${t}</option>`).join("");
  $("awaySelect").innerHTML = `<option value="">Select away team</option>` + teams.map(t => `<option value="${t}">${t}</option>`).join("");
}

function populateFixtures(league) {
  const sel = $("fixtureSelect");
  const fx = FIX.filter(f => normalizeLeagueName(f.league) === league);
  sel.innerHTML = `<option value="">Select Fixture (optional)</option>` + fx.map(f => {
    const key = fixtureKey(f);
    const date = f.date ? ` • ${f.date}` : "";
    return `<option value="${key}">${f.home} vs ${f.away}${date}</option>`;
  }).join("");
}

function renderFixturesTable(league) {
  const container = $("fixturesTable");
  const fx = FIX.filter(f => normalizeLeagueName(f.league) === league);
  if (!fx.length) {
    container.innerHTML = `<div class="muted">No fixtures for this league in fixtures.json</div>`;
    return;
  }

  const sims = Number($("simsInput").value || 10000);
  const homeAdv = Number($("homeAdvInput").value || 1.1);
  const baseGoals = Number($("baseGoalsInput").value || 1.35);
  const maxGoalsCap = Number($("maxGoalsCapInput").value || 8);

  let rows = fx.map((f, idx) => {
    const res = simulateMatch({
      homeTeam: f.home,
      awayTeam: f.away,
      league,
      sims,
      homeAdv,
      baseGoals,
      maxGoalsCap
    });

    if (res.error) {
      return `<tr>
        <td>${idx + 1}</td>
        <td>${f.home} vs ${f.away}<div class="muted">${f.date || ""}</div></td>
        <td colspan="8" class="badText">${res.error}</td>
      </tr>`;
    }

    const ou25 = `O ${res.totals.over25}% / U ${res.totals.under25}%`;
    const ou35 = `O ${res.totals.over35}% / U ${res.totals.under35}%`;
    const x12 = `H ${res.probs.H}% • D ${res.probs.D}% • A ${res.probs.A}%`;
    const ah = `${res.ah.line}${res.ah.coverPct != null ? ` (${res.ah.coverPct}% cover)` : ""}`;

    return `<tr class="clickRow" data-home="${f.home}" data-away="${f.away}">
      <td>${idx + 1}</td>
      <td><b>${f.home}</b> vs <b>${f.away}</b><div class="muted">${league}${f.date ? " • " + f.date : ""}</div></td>
      <td>${res.score}</td>
      <td>${x12}</td>
      <td>${ou25}</td>
      <td>${ou35}</td>
      <td>${ah}</td>
      <td>${res.corners}</td>
      <td>${res.cards}</td>
      <td><b>${res.grade}</b></td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="muted" style="margin:8px 0;">Tap a row to auto-fill teams</div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Match</th><th>Pred</th><th>1X2</th><th>O/U 2.5</th><th>O/U 3.5</th><th>AH</th><th>Corners</th><th>Cards</th><th>Pro</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Tap row → fill selector
  container.querySelectorAll(".clickRow").forEach(tr => {
    tr.addEventListener("click", () => {
      $("homeSelect").value = tr.dataset.home;
      $("awaySelect").value = tr.dataset.away;
      $("statusLine").textContent = `✅ Ready: ${league} — ${tr.dataset.home} vs ${tr.dataset.away}`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderSingleResult(league, homeTeam, awayTeam) {
  const sims = Number($("simsInput").value || 10000);
  const homeAdv = Number($("homeAdvInput").value || 1.1);
  const baseGoals = Number($("baseGoalsInput").value || 1.35);
  const maxGoalsCap = Number($("maxGoalsCapInput").value || 8);

  const res = simulateMatch({ homeTeam, awayTeam, league, sims, homeAdv, baseGoals, maxGoalsCap });
  const out = $("outputCard");

  if (res.error) {
    out.innerHTML = `<div class="card badText">${res.error}</div>`;
    return;
  }

  const h2h = h2hLookup(league, homeTeam, awayTeam);
  const h2hLine = h2h ? `${h2h.score || "-"} • cards ${h2h.cards ?? "-"} • corners ${h2h.corners ?? "-"}` : "—";

  out.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="muted">Model</div>
          <div class="big"><b>${homeTeam}</b> vs <b>${awayTeam}</b></div>
          <div class="muted">${league} • λ ${res.lambdaHome} / ${res.lambdaAway}</div>
        </div>
        <div class="big" style="text-align:right;">
          <div class="muted">Pred</div>
          <div><b>${res.score}</b></div>
        </div>
      </div>

      <div class="pill ok">1X2: H ${res.probs.H}% • D ${res.probs.D}% • A ${res.probs.A}%</div>
      <div class="pill warn">O/U 2.5: Over ${res.totals.over25}% • Under ${res.totals.under25}%</div>
      <div class="pill warn">O/U 3.5: Over ${res.totals.over35}% • Under ${res.totals.under35}%</div>
      <div class="pill">BTTS Yes: ${res.totals.bttsYes}%</div>
      <div class="pill">AH lean: ${res.ah.line}${res.ah.coverPct != null ? ` (${res.ah.coverPct}% cover)` : ""}</div>

      <div class="row">
        <div class="pill">Corners: ${res.corners}</div>
        <div class="pill">Cards: ${res.cards}</div>
      </div>

      <div class="row">
        <div class="pill"><b>Pro grade: ${res.grade}</b></div>
      </div>

      <div class="muted" style="margin-top:10px;">Last H2H</div>
      <div class="card" style="margin-top:6px;">${h2hLine}</div>

      <div class="muted" style="margin-top:10px;">
        Score is most likely score (not average). Corners/cards use real fields if present; otherwise proxies.
      </div>
    </div>
  `;
}

async function init() {
  try {
    setPill("pillFix", false, "fixtures.json (loading...)");
    setPill("pillXg", false, "xg_tables.json (loading...)");
    setPill("pillH2h", false, "h2h.json (loading...)");

    FIX = await loadJSON("fixtures.json");
    setPill("pillFix", true, `fixtures.json (${FIX.length})`);

    XG = await loadJSON("xg_tables.json");
    const teamCount = Object.values(XG).reduce((acc, league) => acc + Object.keys(league || {}).length, 0);
    setPill("pillXg", true, `xg_tables.json (${teamCount} teams)`);

    H2H = await loadJSON("h2h.json");
    setPill("pillH2h", true, `h2h.json (ok)`);

    populateLeagues();

    $("leagueSelect").addEventListener("change", () => {
      const league = $("leagueSelect").value;
      if (!league) return;
      populateTeams(league);
      populateFixtures(league);
      renderFixturesTable(league);
      $("statusLine").textContent = `League loaded: ${league}`;
    });

    $("fixtureSelect").addEventListener("change", () => {
      const league = $("leagueSelect").value;
      if (!league) return;
      const key = $("fixtureSelect").value;
      if (!key) return;

      const f = FIX.find(x => fixtureKey(x) === key);
      if (!f) return;
      $("homeSelect").value = f.home;
      $("awaySelect").value = f.away;
      $("statusLine").textContent = `✅ Ready: ${league} — ${f.home} vs ${f.away}`;
    });

    $("runBtn").addEventListener("click", () => {
      const league = $("leagueSelect").value;
      const homeTeam = $("homeSelect").value;
      const awayTeam = $("awaySelect").value;
      if (!league || !homeTeam || !awayTeam) {
        $("statusLine").textContent = "Pick league + home + away first.";
        return;
      }
      renderSingleResult(league, homeTeam, awayTeam);
      renderFixturesTable(league);
      $("statusLine").textContent = `✅ Done: ${league} — ${homeTeam} vs ${awayTeam}`;
    });

  } catch (e) {
    console.error(e);
    $("statusLine").textContent = "Load error: " + e.message;
    setPill("pillFix", false, "fixtures.json (failed)");
    setPill("pillXg", false, "xg_tables.json (failed)");
    setPill("pillH2h", false, "h2h.json (failed)");
  }
}

document.addEventListener("DOMContentLoaded", init);
