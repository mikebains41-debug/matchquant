/* MatchQuant app.js — FULL REPLACEMENT
   - loads xg_tables.json + fixtures.json (optional)
   - wires Run button
   - renders results (no alert => no "github.io says")
*/

(function () {
  const $ = (id) => document.getElementById(id);

  // Required
  const elLeague  = $("league");
  const elFixture = $("fixture");
  const elHome    = $("home");
  const elAway    = $("away");
  const elSims    = $("sims");
  const elHomeAdv = $("homeAdv");
  const elBase    = $("baseGoals");
  const elCap     = $("capGoals");
  const elRun     = $("runBtn");
  const elResults = $("results");
  const elLoaded  = $("loaded");

  // Optional odds
  const elHomeML  = $("homeML");
  const elDrawML  = $("drawML");
  const elAwayML  = $("awayML");
  const elOver25  = $("over25");
  const elUnder25 = $("under25");
  const elBTTSYes = $("bttsYes");
  const elBTTSNo  = $("bttsNo");

  // AH
  const elAhSide  = $("ahSide");
  const elAhLine  = $("ahLine");
  const elAhOdds  = $("ahOdds");

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

  function leaguesFromXg() {
    const root = xgRaw?.leagues || xgRaw;
    return Object.keys(root || {})
      .filter((k) => k && !k.startsWith("__"))
      .sort((a, b) => a.localeCompare(b));
  }

  function teamsFromXg(leagueName) {
    const root = xgRaw?.leagues || xgRaw;
    const leagueObj = root?.[leagueName];
    if (!leagueObj) return [];
    return Object.keys(leagueObj)
      .filter((k) => k && !k.startsWith("__"))
      .sort((a, b) => a.localeCompare(b));
  }

  function onLeagueChange() {
    const league = elLeague.value;
    const teams = teamsFromXg(league);
    fillSelect(elHome, teams, "Select home team");
    fillSelect(elAway, teams, "Select away team");

    if (elFixture) {
      const list = fixtures?.[league];
      if (Array.isArray(list)) {
        fillSelect(elFixture, list.map(f => `${f.home} vs ${f.away}`), "Select Fixture (optional)");
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

    const f = list.find(x => `${x.home} vs ${x.away}` === label);
    if (!f) return;

    elHome.value = f.home;
    elAway.value = f.away;
  }

  function collectOdds() {
    const o = {
      homeML: safeNum(elHomeML?.value),
      drawML: safeNum(elDrawML?.value),
      awayML: safeNum(elAwayML?.value),
      over25: safeNum(elOver25?.value),
      under25: safeNum(elUnder25?.value),
      bttsYes: safeNum(elBTTSYes?.value),
      bttsNo: safeNum(elBTTSNo?.value),
    };
    const any = Object.values(o).some(v => v !== null);
    return any ? o : null;
  }

  function collectAH() {
    const line = safeNum(elAhLine?.value);
    if (line === null) return null; // none selected
    const side = elAhSide?.value || "Home";
    const odds = safeNum(elAhOdds?.value);
    return { side, line, odds };
  }

  function badgeForEV(ev) {
    if (ev === null || ev === undefined) return "";
    if (ev >= 0.03) return `<span class="badge good">+EV</span>`;
    if (ev <= -0.03) return `<span class="badge bad">-EV</span>`;
    return `<span class="badge warn">NEAR</span>`;
  }

  function fmtPct(x) { return `${(x * 100).toFixed(1)}%`; }

  function renderResult(r) {
    const topLines = r.top5
      .map(x => `${x.score} (${(x.prob * 100).toFixed(1)}%)`)
      .join("<br>");

    const miss = (r.missing && r.missing.length)
      ? `<div class="hr"></div><div class="small">⚠️ Team name mismatch in xg_tables.json for: <b>${r.missing.join(", ")}</b></div>`
      : "";

    const ev = r.ev || {};
    const evLine = (label, obj) => {
      if (!obj || obj.odds === null || obj.odds === undefined) return "";
      const evTxt = (obj.ev === null) ? "" : ` <span class="small">(EV ${(obj.ev*100).toFixed(1)}%)</span>`;
      return `<div>${label}: <b>${obj.odds}</b>${badgeForEV(obj.ev)}${evTxt}</div>`;
    };

    const oddsBlock = (r.ev && Object.keys(r.ev).length) ? `
      <div class="hr"></div>
      <div><b>Odds EV check</b> <span class="small">(only if you entered odds)</span></div>
      ${evLine(`${r.home} ML`, ev.homeML)}
      ${evLine(`Draw`, ev.drawML)}
      ${evLine(`${r.away} ML`, ev.awayML)}
      ${evLine(`Over 2.5`, ev.over25)}
      ${evLine(`Under 2.5`, ev.under25)}
      ${evLine(`BTTS Yes`, ev.bttsYes)}
      ${evLine(`BTTS No`, ev.bttsNo)}
      ${r.ahEV?.odds ? evLine(`AH (${r.ahOut?.side} ${r.ahOut?.line})`, r.ahEV) : ""}
    ` : "";

    const ahBlock = r.ahOut ? `
      <div style="margin-top:10px"><b>Asian Handicap</b></div>
      <div class="small">(${r.ahOut.side} ${r.ahOut.line}) cover: <b>${fmtPct(r.ahOut.pCover)}</b> · push: ${fmtPct(r.ahOut.pPush)}</div>
    ` : "";

    elResults.innerHTML = `
      <div>
        <div style="font-weight:800;font-size:18px">${r.home} vs ${r.away}</div>
        <div class="small">${r.league} · league_factor ${r.leagueFactor.toFixed(2)}</div>

        <div class="hr"></div>

        <div><b>Win Probabilities</b></div>
        <div>${r.home}: <b>${fmtPct(r.pW)}</b></div>
        <div>Draw: <b>${fmtPct(r.pD)}</b></div>
        <div>${r.away}: <b>${fmtPct(r.pL)}</b></div>

        <div style="margin-top:10px"><b>Most Likely Score</b>: ${r.bestScore}</div>

        <div style="margin-top:10px"><b>O/U 2.5</b></div>
        <div>Over 2.5: <b>${fmtPct(r.pOver25)}</b></div>
        <div>Under 2.5: <b>${fmtPct(r.pUnder25)}</b></div>

        <div style="margin-top:10px"><b>BTTS (Yes)</b>: <b>${fmtPct(r.pBTTS)}</b></div>

        ${ahBlock}

        <div style="margin-top:10px"><b>Model means</b></div>
        <div class="small">mu(home) ${r.muHome.toFixed(2)} · mu(away) ${r.muAway.toFixed(2)} · cap ${r.cap}</div>

        <div style="margin-top:10px"><b>Top 5 scorelines</b><br>${topLines}</div>

        ${oddsBlock}
        ${miss}
      </div>
    `;
  }

  function renderError(err) {
    const msg = err?.message ? err.message : String(err);
    elResults.innerHTML = `
      <div style="color:#ffb4b4">
        <b>Prediction error:</b><br>
        <span class="mono">${msg}</span>
        <div class="hr"></div>
        <div class="small">
          If you just updated files on GitHub Pages, refresh once (cache).
          Also confirm these files exist at repo root: <span class="mono">xg_tables.json</span> and (optional) <span class="mono">fixtures.json</span>.
        </div>
      </div>
    `;
  }

  async function loadAll() {
    setStatus("Loading data…");

    const [xgRes, fxRes] = await Promise.all([
      fetch("xg_tables.json", { cache: "no-store" }),
      fetch("fixtures.json", { cache: "no-store" }).catch(() => null),
    ]);

    if (!xgRes.ok) throw new Error("Failed to load xg_tables.json");
    xgRaw = await xgRes.json();

    if (fxRes && fxRes.ok) fixtures = await fxRes.json();
    else fixtures = null;

    const leagues = leaguesFromXg();
    fillSelect(elLeague, leagues, "Select league");
    elLeague.value = leagues[0] || "";

    onLeagueChange();

    setStatus(`Loaded: ${leagues.length} leagues${fixtures ? " · fixtures OK" : ""}`);
  }

  function wire() {
    elLeague.addEventListener("change", onLeagueChange);
    if (elFixture) elFixture.addEventListener("change", onFixtureChange);

    elRun.addEventListener("click", () => {
      try {
        if (!window.runPrediction) throw new Error("engine.js not loaded (runPrediction missing). Check script order.");

        const league = elLeague.value;
        const home = elHome.value;
        const away = elAway.value;

        if (!league) throw new Error("Pick a league first.");
        if (!home || !away) throw new Error("Pick both teams.");
        if (home === away) throw new Error("Home and Away cannot be the same team.");

        const params = {
          league,
          home,
          away,
          homeAdv: safeNum(elHomeAdv.value) ?? 1.10,
          baseGoals: safeNum(elBase.value) ?? 1.35,
          capGoals: safeNum(elCap.value) ?? 8,
          sims: safeNum(elSims?.value) ?? 10000,
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

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      wire();
      await loadAll();
      elResults.textContent = "Pick league + teams, then press Run Prediction.";
    } catch (err) {
      console.error(err);
      renderError(err);
      setStatus("Load failed.");
    }
  });
})();
