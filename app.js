/* MatchQuant app.js — FULL REPLACEMENT (loads json + wires Run button + renders Results box) */

(function () {
  const $ = (id) => document.getElementById(id);

  // Elements (must exist in your HTML)
  const elLeague  = $("league");
  const elFixture = $("fixture");
  const elHome    = $("home");
  const elAway    = $("away");
  const elSims    = $("sims");
  const elHomeAdv = $("homeAdv");
  const elBase    = $("baseGoals");
  const elCap     = $("capGoals");
  const elRun     = $("runBtn");

  // Optional odds inputs (only if present in HTML)
  const elHomeML  = $("homeML");
  const elDrawML  = $("drawML");
  const elAwayML  = $("awayML");
  const elOver25  = $("over25");
  const elUnder25 = $("under25");
  const elBTTSYes = $("bttsYes");
  const elBTTSNo  = $("bttsNo");

  const elAhSide  = $("ahSide");
  const elAhLine  = $("ahLine");
  const elAhOdds  = $("ahOdds");

  const elResults = $("results"); // a div to show output
  const elLoaded  = $("loaded");  // small status text (optional)

  // Data
  let xgRaw = null;
  let fixtures = null;

  function setStatus(msg) {
    if (elLoaded) elLoaded.textContent = msg;
  }

  function safeNum(v) {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fillSelect(select, items, placeholder) {
    select.innerHTML = "";
    if (placeholder) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = placeholder;
      select.appendChild(o);
    }
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it;
      o.textContent = it;
      select.appendChild(o);
    }
  }

  function teamsFromXg(leagueName) {
    if (!xgRaw) return [];
    const root = xgRaw.leagues || xgRaw;
    const leagueObj = root?.[leagueName];
    if (!leagueObj) return [];

    return Object.keys(leagueObj)
      .filter((k) => k && !k.startsWith("__"))
      .sort((a, b) => a.localeCompare(b));
  }

  function leaguesFromXg() {
    if (!xgRaw) return [];
    const root = xgRaw.leagues || xgRaw;
    return Object.keys(root || {})
      .filter((k) => k && !k.startsWith("__"))
      .sort((a, b) => a.localeCompare(b));
  }

  function renderResult(r) {
    const topLines = r.top5
      .map((x) => `${x.score} (${(x.prob * 100).toFixed(1)}%)`)
      .join("<br>");

    const miss = r.missing?.length
      ? `<div style="margin-top:10px;opacity:.9">⚠️ Missing team match in xg_tables.json: <b>${r.missing.join(", ")}</b></div>`
      : "";

    const ah = r.ahOut
      ? `<div style="margin-top:8px"><b>AH cover prob</b> (${r.ahOut.side} ${r.ahOut.line}): ${(r.ahOut.pCover * 100).toFixed(1)}%</div>`
      : "";

    elResults.innerHTML = `
      <div style="line-height:1.45">
        <div style="font-weight:700;font-size:18px">${r.home} vs ${r.away}</div>
        <div style="opacity:.85;margin-top:2px">${r.league}</div>

        <hr style="border:0;border-top:1px solid rgba(255,255,255,.12);margin:12px 0">

        <div><b>Win Probabilities</b></div>
        <div>${r.home}: ${(r.pW * 100).toFixed(1)}%</div>
        <div>Draw: ${(r.pD * 100).toFixed(1)}%</div>
        <div>${r.away}: ${(r.pL * 100).toFixed(1)}%</div>

        <div style="margin-top:10px"><b>Most Likely Score</b>: ${r.bestScore}</div>

        <div style="margin-top:10px"><b>O/U 2.5</b></div>
        <div>Over 2.5: ${(r.pOver25 * 100).toFixed(1)}%</div>
        <div>Under 2.5: ${(r.pUnder25 * 100).toFixed(1)}%</div>

        <div style="margin-top:10px"><b>BTTS (Yes)</b>: ${(r.pBTTS * 100).toFixed(1)}%</div>

        ${ah}

        <div style="margin-top:10px"><b>xG means</b></div>
        <div>${r.home}: ${r.muHome.toFixed(2)}</div>
        <div>${r.away}: ${r.muAway.toFixed(2)}</div>

        <div style="margin-top:10px"><b>Top 5 scorelines</b><br>${topLines}</div>

        ${miss}
      </div>
    `;
  }

  function renderError(err) {
    const msg = (err && err.message) ? err.message : String(err);
    elResults.innerHTML = `
      <div style="color:#ffb4b4">
        <b>Prediction error:</b><br>${msg}
        <div style="margin-top:10px;opacity:.9;color:#ddd">
          Tip: refresh once (GitHub Pages cache), then try again.
        </div>
      </div>
    `;
  }

  function onLeagueChange() {
    const league = elLeague.value;
    const teams = teamsFromXg(league);
    fillSelect(elHome, teams, "Select home team");
    fillSelect(elAway, teams, "Select away team");

    // Fixtures (optional)
    if (elFixture) {
      if (fixtures && fixtures[league] && Array.isArray(fixtures[league])) {
        const fx = fixtures[league].map((f) => `${f.home} vs ${f.away}`);
        fillSelect(elFixture, fx, "Select Fixture (optional)");
      } else {
        fillSelect(elFixture, [], "Select Fixture (optional)");
      }
    }
  }

  function onFixtureChange() {
    if (!elFixture || !fixtures) return;
    const league = elLeague.value;
    const label = elFixture.value;
    if (!label) return;

    const list = fixtures?.[league];
    if (!Array.isArray(list)) return;

    const f = list.find((x) => `${x.home} vs ${x.away}` === label);
    if (!f) return;

    elHome.value = f.home;
    elAway.value = f.away;
  }

  function collectOdds() {
    // only if inputs exist & user typed something
    const o = {
      homeML: safeNum(elHomeML?.value),
      drawML: safeNum(elDrawML?.value),
      awayML: safeNum(elAwayML?.value),
      over25: safeNum(elOver25?.value),
      under25: safeNum(elUnder25?.value),
      bttsYes: safeNum(elBTTSYes?.value),
      bttsNo: safeNum(elBTTSNo?.value),
    };
    const any = Object.values(o).some((v) => v !== null);
    if (!any) return null;
    return o;
  }

  function collectAH() {
    if (!elAhSide || !elAhLine) return null;
    const side = elAhSide.value || "Home";
    const line = safeNum(elAhLine.value);
    if (line === null) return null;
    const odds = safeNum(elAhOdds?.value);
    return { side, line, odds };
  }

  async function loadAll() {
    setStatus("Loading data...");

    // These files are in the same folder as index.html
    const [xgRes, fxRes] = await Promise.all([
      fetch("xg_tables.json", { cache: "no-store" }),
      fetch("fixtures.json", { cache: "no-store" }).catch(() => null),
    ]);

    if (!xgRes.ok) throw new Error("Failed to load xg_tables.json");
    xgRaw = await xgRes.json();

    if (fxRes && fxRes.ok) {
      fixtures = await fxRes.json();
    } else {
      fixtures = null;
    }

    const leagues = leaguesFromXg();
    fillSelect(elLeague, leagues, "Select league");
    elLeague.value = leagues[0] || "";

    onLeagueChange();
    setStatus(`Loaded: ${leagues.length} leagues`);
  }

  function wire() {
    elLeague.addEventListener("change", onLeagueChange);
    if (elFixture) elFixture.addEventListener("change", onFixtureChange);

    elRun.addEventListener("click", () => {
      try {
        const league = elLeague.value;
        const home = elHome.value;
        const away = elAway.value;

        const params = {
          league,
          home,
          away,
          homeAdv: safeNum(elHomeAdv.value) ?? 1.10,
          baseGoals: safeNum(elBase.value) ?? 1.35,
          capGoals: safeNum(elCap.value) ?? 8,
          sims: safeNum(elSims?.value) ?? 10000, // kept for UI
          xgRaw,
          odds: collectOdds(),
          ah: collectAH(),
        };

        const out = window.runPrediction(params);
        renderResult(out);
      } catch (err) {
        console.error(err);
        renderError(err);
      }
    });
  }

  // boot
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      wire();
      await loadAll();
      if (elResults) elResults.textContent = "Pick league + teams, then press Run Prediction.";
    } catch (err) {
      console.error(err);
      renderError(err);
      setStatus("Load failed.");
    }
  });
})();
