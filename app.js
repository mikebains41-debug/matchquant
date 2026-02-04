/* =========================
   MatchQuant v2 (1–6 ON)
   1 EV badges
   2 Top scorelines
   3 Confidence tiers
   4 Charts (scoreline probs)
   5 Auto today fixtures (auto-run on load)
   6 Sellable structure
========================= */

let xgTables = {};
let fixtures = {};
let h2hData = {};

/* ---------- HELPERS ---------- */
const $ = (id) => document.getElementById(id);

function safeSet(id, text) {
  const el = $(id);
  if (el) el.innerText = text;
}

function num(id) {
  const el = $(id);
  if (!el) return null;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : null;
}

/* ---------- LOAD DATA ---------- */
async function loadJSON() {
  xgTables = await fetch("xg_tables.json").then(r => r.json());
  fixtures = await fetch("fixtures.json").then(r => r.json());
  h2hData = await fetch("h2h.json").then(r => r.json());
}

/* ---------- POISSON ---------- */
function poisson(lambda) {
  let L = Math.exp(-lambda);
  let p = 1, k = 0;
  while (p > L) { k++; p *= Math.random(); }
  return k - 1;
}

/* ---------- MONTE CARLO ---------- */
function monteCarlo(homeλ, awayλ, sims = 10000) {
  let scores = {};           // "2-1" -> count
  let H = 0, D = 0, A = 0;
  let over25 = 0, under25 = 0;

  for (let i = 0; i < sims; i++) {
    let h = poisson(homeλ);
    let a = poisson(awayλ);
    let key = `${h}-${a}`;
    scores[key] = (scores[key] || 0) + 1;

    if (h > a) H++;
    else if (h < a) A++;
    else D++;

    if (h + a >= 3) over25++;
    else under25++;
  }

  // Top scorelines
  const topScores = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s, c]) => ({ score: s, pct: (c / sims * 100) }));

  // Build chart bins = top 10 scorelines by freq
  const chartBins = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([s, c]) => ({ label: s, value: (c / sims * 100) }));

  return {
    probs: {
      H: (H / sims * 100),
      D: (D / sims * 100),
      A: (A / sims * 100),
      over25: (over25 / sims * 100),
      under25: (under25 / sims * 100)
    },
    topScores,
    chartBins
  };
}

/* ---------- EV BADGE ---------- */
function evBadge(probPct, odds) {
  if (!odds || odds <= 1) return "—";
  const p = probPct / 100;
  const ev = p * odds; // >1 is +EV vs fair
  if (ev >= 1.06) return "🟢 Positive EV";
  if (ev >= 1.00) return "🟡 Close";
  return "🔴 Negative EV";
}

/* ---------- CONFIDENCE TIER ---------- */
function confidenceTier(edgePct) {
  if (edgePct >= 65) return "Tier 1 (Strong)";
  if (edgePct >= 58) return "Tier 2 (Good)";
  if (edgePct >= 52) return "Tier 3 (Lean)";
  return "Tier 4 (No edge)";
}

/* ---------- DATE + FIXTURES ---------- */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function todayFixturesForLeague(league) {
  const t = todayISO();
  return (fixtures[league] || []).filter(f => f.date === t);
}

function allTodayFixtures() {
  const t = todayISO();
  const out = [];
  for (const league of Object.keys(fixtures || {})) {
    const games = (fixtures[league] || []).filter(f => f.date === t);
    for (const g of games) out.push({ league, ...g });
  }
  return out;
}

/* ---------- SIMPLE CANVAS BAR CHART ---------- */
function drawBarChart(canvasId, title, bins) {
  const canvas = $(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // clear
  ctx.clearRect(0, 0, W, H);

  // padding
  const padL = 44, padR = 12, padT = 28, padB = 36;

  // title
  ctx.font = "bold 14px system-ui";
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(title, padL, 18);

  // axes
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  if (!bins || !bins.length) return;

  const maxV = Math.max(...bins.map(b => b.value), 1);
  const plotW = (W - padL - padR);
  const plotH = (H - padT - padB);
  const gap = 6;
  const barW = Math.max(10, (plotW - gap * (bins.length - 1)) / bins.length);

  // y labels
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#94a3b8";
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i / 4);
    const y = (H - padB) - (plotH * i / 4);
    ctx.fillText(v.toFixed(1) + "%", 6, y + 4);
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }

  // bars
  let x = padL;
  for (const b of bins) {
    const h = (b.value / maxV) * plotH;
    const y = (H - padB) - h;

    // bar
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(x, y, barW, h);

    // label
    ctx.save();
    ctx.translate(x + barW / 2, H - padB + 14);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(b.label, 0, 0);
    ctx.restore();

    x += barW + gap;
  }
}

/* ---------- MAIN PREDICT (MANUAL) ---------- */
window.runPrediction = function () {
  const league = $("league")?.value;
  const home = $("homeTeam")?.value?.trim();
  const away = $("awayTeam")?.value?.trim();
  const sims = parseInt($("sims")?.value || "10000", 10) || 10000;

  if (!league || !home || !away) {
    alert("Pick league + home + away");
    return;
  }
  if (!xgTables?.[league]?.[home] || !xgTables?.[league]?.[away]) {
    alert("Team not found in xg_tables.json for this league.");
    return;
  }

  const homeλ = Number(xgTables[league][home]);
  const awayλ = Number(xgTables[league][away]);

  const mc = monteCarlo(homeλ, awayλ, sims);

  const H = mc.probs.H;
  const D = mc.probs.D;
  const A = mc.probs.A;

  const top1 = mc.topScores[0]?.score || "—";
  const tier = confidenceTier(Math.max(H, A));

  safeSet("resLeague", league);
  safeSet("resMatch", `${home} vs ${away}`);
  safeSet("resXG", `Home λ ${homeλ.toFixed(2)} / Away λ ${awayλ.toFixed(2)}`);
  safeSet("resScore", top1);

  // O/U
  safeSet("resOU", mc.probs.over25 >= 50 ? `Over 2.5 (${mc.probs.over25.toFixed(0)}%)` : `Under 2.5 (${mc.probs.under25.toFixed(0)}%)`);

  // AH: basic placeholder using win prob
  safeSet("resAH", H >= 50 ? "Home -0.5 lean" : (A >= 50 ? "Away +0.5 lean" : "0 (DNB / No lean)"));

  safeSet("resWin", `H ${H.toFixed(0)}% / D ${D.toFixed(0)}% / A ${A.toFixed(0)}%`);
  safeSet("resTier", tier);

  // Top scorelines
  safeSet("resTop", mc.topScores.map(s => `${s.score} (${s.pct.toFixed(1)}%)`).join(", "));

  // EV badges (use whatever odds user entered)
  const oddsHome = num("oddsHome");
  const oddsDraw = num("oddsDraw");
  const oddsAway = num("oddsAway");
  const oddsO25 = num("oddsOver25");
  const oddsU25 = num("oddsUnder25");
  const oddsAHHome = num("oddsAHHome"); // AH Home -0.5

  const evs = [];
  if (oddsHome) evs.push(`ML Home: ${evBadge(H, oddsHome)}`);
  if (oddsDraw) evs.push(`ML Draw: ${evBadge(D, oddsDraw)}`);
  if (oddsAway) evs.push(`ML Away: ${evBadge(A, oddsAway)}`);
  if (oddsO25) evs.push(`O2.5: ${evBadge(mc.probs.over25, oddsO25)}`);
  if (oddsU25) evs.push(`U2.5: ${evBadge(mc.probs.under25, oddsU25)}`);
  if (oddsAHHome) evs.push(`AH Home -0.5: ${evBadge(H, oddsAHHome)}`);

  safeSet("resEV", evs.length ? evs.join(" | ") : "—");

  // CHART (Top scoreline probabilities)
  drawBarChart("scoreChart", "Top scoreline probabilities (MC)", mc.chartBins);
};

/* ---------- TODAY FIXTURES (AUTO) ---------- */
function renderTodayList(games) {
  const box = $("todayBox");
  if (!box) return;

  if (!games.length) {
    box.innerHTML = `<div style="opacity:.8">No fixtures found for today (${todayISO()}).</div>`;
    return;
  }

  // Render clickable list
  box.innerHTML = games.map((g, i) => {
    const home = g.home;
    const away = g.away;
    const lg = g.league;
    return `
      <button
        data-i="${i}"
        style="width:100%;text-align:left;padding:10px 12px;border-radius:14px;
               border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18);
               color:#e5e7eb;margin:6px 0;">
        <div style="font-weight:700">${lg}: ${home} vs ${away}</div>
        <div style="opacity:.75;font-size:12px">${g.date || todayISO()}</div>
      </button>
    `;
  }).join("");

  // click -> fill manual inputs
  [...box.querySelectorAll("button")].forEach(btn => {
    btn.addEventListener("click", () => {
      const g = games[parseInt(btn.dataset.i, 10)];
      if ($("league")) $("league").value = g.league;
      if ($("homeTeam")) $("homeTeam").value = g.home;
      if ($("awayTeam")) $("awayTeam").value = g.away;
      // run immediately
      window.runPrediction();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ---------- BOOT ---------- */
async function boot() {
  await loadJSON();

  // Auto today fixtures on load (ALL leagues)
  const games = allTodayFixtures();
  renderTodayList(games);

  // Optional: auto-refresh today list if league changes (still shows all by default)
  const leagueEl = $("league");
  if (leagueEl) {
    leagueEl.addEventListener("change", () => {
      // show only selected league's today fixtures
      const lg = leagueEl.value;
      const list = todayFixturesForLeague(lg).map(g => ({ league: lg, ...g }));
      renderTodayList(list);
    });
  }
}

document.addEventListener("DOMContentLoaded", boot);
