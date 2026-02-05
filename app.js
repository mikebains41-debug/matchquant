/* app.js — MatchQuant (Phone/PWA friendly)
   Expects files in repo root:
   - index.html (should have a container with id="app" OR it will create one)
   - fixtures.json
   - h2h.json
   - xg_tables.json
   - league-chemp.csv
*/

(async function () {
  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);

  function ensureAppContainer() {
    let el = $("#app");
    if (!el) {
      el = document.createElement("div");
      el.id = "app";
      document.body.prepend(el);
    }
    return el;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeNum(x, fallback = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }

  // Poisson random draw (Knuth)
  function poisson(lambda) {
    if (!(lambda > 0)) return 0;
    let L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  // Monte Carlo score distribution
  function simulateMatch(lambdaHome, lambdaAway, sims = 12000) {
    const scoreCounts = new Map();
    let homeWin = 0, draw = 0, awayWin = 0;
    let over25 = 0, under25 = 0;

    for (let i = 0; i < sims; i++) {
      const h = poisson(lambdaHome);
      const a = poisson(lambdaAway);
      const key = `${h}-${a}`;
      scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);

      if (h > a) homeWin++;
      else if (h === a) draw++;
      else awayWin++;

      if (h + a > 2.5) over25++;
      else under25++;
    }

    // Most likely score
    let bestScore = "1-1";
    let bestCount = -1;
    for (const [k, v] of scoreCounts.entries()) {
      if (v > bestCount) {
        bestCount = v;
        bestScore = k;
      }
    }

    return {
      bestScore,
      pHome: homeWin / sims,
      pDraw: draw / sims,
      pAway: awayWin / sims,
      pOver25: over25 / sims,
      pUnder25: under25 / sims,
      scoreCounts,
    };
  }

  // ---------- CSV parsing (handles ; delimiter + quotes) ----------
  function parseCSV(text) {
    // supports separator as ; or ,
    // your file shows: number;"team";"matches";...
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Guess delimiter by looking at header
    const headerLine = lines[0];
    const semi = (headerLine.match(/;/g) || []).length;
    const comma = (headerLine.match(/,/g) || []).length;
    const delim = semi >= comma ? ";" : ",";

    function parseLine(line) {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          // toggle quotes unless it's escaped
          const next = line[i + 1];
          if (inQuotes && next === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === delim && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    }

    const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, ""));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length === 0) continue;
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j] || `col${j}`;
        obj[key] = (cols[j] ?? "").replace(/^"|"$/g, "");
      }
      rows.push(obj);
    }
    return rows;
  }

  // ---------- Data normalization ----------
  // xg_tables.json can be many shapes; we normalize to:
  // team -> { xg_for, xg_against, matches }
  function normalizeXGTables(xgRaw) {
    const map = new Map();

    function addTeam(team, rec) {
      if (!team) return;
      const t = String(team).trim();
      if (!t) return;

      // try many key spellings
      const matches =
        safeNum(rec.matches ?? rec.mp ?? rec.played ?? rec.MP ?? rec["matches"], 0);

      const xgFor =
        safeNum(rec.xg_for ?? rec.xG ?? rec.xg ?? rec["xg"] ?? rec["xG_for"] ?? rec["xG"], NaN);
      const xgAgainst =
        safeNum(rec.xg_against ?? rec.xGA ?? rec.xga ?? rec["xga"] ?? rec["xG_against"] ?? rec["xGA"], NaN);

      // Some tables store totals; some per match. We try to infer:
      // If matches exists and xgFor is big (> matches*1.5) it might be total.
      let xf = xgFor;
      let xa = xgAgainst;

      if (Number.isFinite(matches) && matches > 0) {
        if (Number.isFinite(xf) && xf > matches * 2.2) xf = xf / matches;
        if (Number.isFinite(xa) && xa > matches * 2.2) xa = xa / matches;
      }

      // fallback keys commonly used in exports
      if (!Number.isFinite(xf)) xf = safeNum(rec.gf_xg ?? rec.for_xg ?? rec.attack_xg, 1.25);
      if (!Number.isFinite(xa)) xa = safeNum(rec.ga_xg ?? rec.against_xg ?? rec.defense_xg, 1.25);

      map.set(t, { xg_for: xf, xg_against: xa, matches: matches || 0 });
    }

    // shapes:
    // 1) array of team records
    // 2) object { league: [records] }
    // 3) object { team: record }
    if (Array.isArray(xgRaw)) {
      for (const rec of xgRaw) addTeam(rec.team ?? rec.Team ?? rec.name, rec);
    } else if (xgRaw && typeof xgRaw === "object") {
      const keys = Object.keys(xgRaw);
      for (const k of keys) {
        const v = xgRaw[k];
        if (Array.isArray(v)) {
          for (const rec of v) addTeam(rec.team ?? rec.Team ?? rec.name, rec);
        } else if (v && typeof v === "object") {
          // maybe keyed by team name
          // if v looks like team stats, use k as team name
          const hasXG = ("xg" in v) || ("xG" in v) || ("xga" in v) || ("xGA" in v) || ("xg_for" in v) || ("xg_against" in v);
          if (hasXG) addTeam(k, v);
        }
      }
    }
    return map;
  }

  // League factor from league-chemp.csv
  // Uses goals per match as a scaling factor; baseline ~2.7
  function buildLeagueFactor(leagueRows) {
    // Map team -> their goals per match as a proxy for league attacking environment
    // If your CSV is a league table, not per league, we still compute average goals per match.
    let totalGoals = 0;
    let totalMatches = 0;

    for (const r of leagueRows) {
      const matches = safeNum(r.matches ?? r.MP ?? r.played, 0);
      const goals = safeNum(r.goals ?? r.gf ?? r.GF, 0);
      if (matches > 0 && goals >= 0) {
        totalGoals += goals;
        totalMatches += matches;
      }
    }

    // Each match counted twice across teams in a table (home+away), so divide by 2
    const goalsPerMatch = totalMatches > 0 ? (totalGoals / totalMatches) * 2 : 2.7;
    const baseline = 2.7;

    // Convert to gentle factor
    const raw = goalsPerMatch / baseline;
    return clamp(raw, 0.80, 1.20);
  }

  // Match lambdas from xG + opponent defense + home advantage + league factor
  function expectedGoals(homeTeam, awayTeam, xgMap, leagueFactor) {
    const home = xgMap.get(homeTeam) || null;
    const away = xgMap.get(awayTeam) || null;

    // fallback sane values
    const homeAtk = home ? safeNum(home.xg_for, 1.30) : 1.30;
    const homeDef = home ? safeNum(home.xg_against, 1.30) : 1.30;

    const awayAtk = away ? safeNum(away.xg_for, 1.20) : 1.20;
    const awayDef = away ? safeNum(away.xg_against, 1.35) : 1.35;

    // league average xG per team per match
    // We estimate from the map:
    let avgFor = 1.25, avgAgainst = 1.25;
    if (xgMap.size > 0) {
      let sumF = 0, sumA = 0, n = 0;
      for (const v of xgMap.values()) {
        const f = safeNum(v.xg_for, NaN);
        const a = safeNum(v.xg_against, NaN);
        if (Number.isFinite(f) && Number.isFinite(a)) {
          sumF += f; sumA += a; n++;
        }
      }
      if (n > 0) {
        avgFor = sumF / n;
        avgAgainst = sumA / n;
      }
    }

    // Attack/Defense strength ratios
    const homeAttackStrength = homeAtk / avgFor;
    const awayAttackStrength = awayAtk / avgFor;

    const homeDefenseWeakness = homeDef / avgAgainst; // >1 means leaky
    const awayDefenseWeakness = awayDef / avgAgainst;

    // Base team xG per match in this competition
    const baseTeamXG = (avgFor + avgAgainst) / 2;

    // Home advantage (gentle)
    const homeAdv = 1.10;

    // Expected goals:
    // Home lambda increases with home attack strength and away defense weakness
    // Away lambda increases with away attack strength and home defense weakness
    let lambdaHome = baseTeamXG * homeAttackStrength * awayDefenseWeakness * homeAdv * leagueFactor;
    let lambdaAway = baseTeamXG * awayAttackStrength * homeDefenseWeakness * (1 / homeAdv) * leagueFactor;

    // clamp to realistic soccer ranges
    lambdaHome = clamp(lambdaHome, 0.15, 3.20);
    lambdaAway = clamp(lambdaAway, 0.15, 3.00);

    return { lambdaHome, lambdaAway };
  }

  function formatPct(p) {
    return `${Math.round(p * 100)}%`;
  }

  function estimateCorners(lambdaHome, lambdaAway) {
    // crude but useful: more xG -> more corners; add a small base
    const totalXG = lambdaHome + lambdaAway;
    const corners = 7.5 + totalXG * 1.8; // typical range 8–12
    return Math.round(corners);
  }

  function estimateCards(lambdaHome, lambdaAway) {
    // crude: tighter games often more cards; very open games slightly less
    const diff = Math.abs(lambdaHome - lambdaAway);
    const base = 4.2;
    const cards = base + (diff < 0.4 ? 0.6 : 0.0);
    return Math.round(cards);
  }

  // ---------- Load + Render ----------
  const app = ensureAppContainer();
  app.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
      <h2 style="margin:0 0 8px 0;">MatchQuant</h2>
      <div id="status" style="opacity:.8;margin-bottom:12px;">Loading data...</div>
      <div id="tableWrap"></div>
      <div style="opacity:.7;font-size:12px;margin-top:10px;">
        Notes: Score = most likely score from simulations (not an average). Probabilities are Monte Carlo estimates.
      </div>
    </div>
  `;

  const status = $("#status");
  const tableWrap = $("#tableWrap");

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.json();
  }

  async function loadText(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.text();
  }

  try {
    const [fixturesRaw, h2hRaw, xgRaw, leagueCsvText] = await Promise.all([
      loadJson("fixtures.json"),
      loadJson("h2h.json"),
      loadJson("xg_tables.json"),
      loadText("league-chemp.csv"),
    ]);

    const fixtures = Array.isArray(fixturesRaw) ? fixturesRaw : (fixturesRaw.fixtures || fixturesRaw.matches || []);
    const h2h = h2hRaw && typeof h2hRaw === "object" ? h2hRaw : {};
    const xgMap = normalizeXGTables(xgRaw);

    const leagueRows = parseCSV(leagueCsvText);
    const leagueFactor = buildLeagueFactor(leagueRows);

    status.textContent = `Loaded. Fixtures: ${fixtures.length} | Teams with xG: ${xgMap.size} | League factor: ${leagueFactor.toFixed(2)}`;

    // Build rows
    const rows = fixtures.map((fx, idx) => {
      const home = fx.home || fx.homeTeam || fx.Home || fx.team_home || fx.h || "";
      const away = fx.away || fx.awayTeam || fx.Away || fx.team_away || fx.a || "";
      const league = fx.league || fx.competition || fx.L || "";
      const date = fx.date || fx.kickoff || fx.time || fx.datetime || "";

      const { lambdaHome, lambdaAway } = expectedGoals(home, away, xgMap, leagueFactor);
      const sim = simulateMatch(lambdaHome, lambdaAway, 14000);

      // Pull a last H2H string if present (you can store any structure; we try common ones)
      const h2hKey1 = `${home} vs ${away}`;
      const h2hKey2 = `${away} vs ${home}`;
      let h2hText = "";
      const h = h2h[h2hKey1] || h2h[h2hKey2] || null;

      if (h) {
        if (typeof h === "string") {
          h2hText = h;
        } else if (typeof h === "object") {
          const score = h.score || h.last_score || h.result || "";
          const corners = h.corners ?? h.last_corners ?? "";
          const cards = h.cards ?? h.last_cards ?? "";
          const bits = [];
          if (score) bits.push(`Score ${score}`);
          if (corners !== "") bits.push(`Corners ${corners}`);
          if (cards !== "") bits.push(`Cards ${cards}`);
          h2hText = bits.join(" • ");
        }
      }

      const cornersEst = estimateCorners(lambdaHome, lambdaAway);
      const cardsEst = estimateCards(lambdaHome, lambdaAway);

      return {
        idx: idx + 1,
        league,
        date,
        home,
        away,
        lambdaHome,
        lambdaAway,
        score: sim.bestScore,
        pHome: sim.pHome,
        pDraw: sim.pDraw,
        pAway: sim.pAway,
        pOver25: sim.pOver25,
        pUnder25: sim.pUnder25,
        cornersEst,
        cardsEst,
        h2hText,
      };
    });

    // Render table
    const html = `
      <div style="overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:rgba(255,255,255,.06);text-align:left;">
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">#</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">Match</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">Pred</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">1X2</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">O/U 2.5</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">Corners</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">Cards</th>
              <th style="padding:10px;border-bottom:1px solid rgba(255,255,255,.10);">Last H2H</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.08);">
                <td style="padding:10px;white-space:nowrap;opacity:.8;">${r.idx}</td>
                <td style="padding:10px;">
                  <div style="font-weight:600;">${escapeHtml(r.home)} vs ${escapeHtml(r.away)}</div>
                  <div style="opacity:.7;font-size:12px;">
                    ${escapeHtml(r.league)} ${r.date ? "• " + escapeHtml(r.date) : ""}
                    • λ ${r.lambdaHome.toFixed(2)} / ${r.lambdaAway.toFixed(2)}
                  </div>
                </td>
                <td style="padding:10px;font-weight:700;white-space:nowrap;">${escapeHtml(r.score)}</td>
                <td style="padding:10px;white-space:nowrap;">
                  H ${formatPct(r.pHome)} • D ${formatPct(r.pDraw)} • A ${formatPct(r.pAway)}
                </td>
                <td style="padding:10px;white-space:nowrap;">
                  Over ${formatPct(r.pOver25)} • Under ${formatPct(r.pUnder25)}
                </td>
                <td style="padding:10px;white-space:nowrap;">${r.cornersEst}</td>
                <td style="padding:10px;white-space:nowrap;">${r.cardsEst}</td>
                <td style="padding:10px;opacity:.85;">${escapeHtml(r.h2hText || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    tableWrap.innerHTML = html;

  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
    tableWrap.innerHTML = `
      <div style="padding:12px;border:1px solid rgba(255,0,0,.35);border-radius:12px;">
        <div style="font-weight:700;margin-bottom:6px;">Couldn’t load one of the required files.</div>
        <div style="opacity:.8;font-size:13px;">
          Make sure these are in the repo root and spelled exactly:<br>
          <code>fixtures.json</code>, <code>h2h.json</code>, <code>xg_tables.json</code>, <code>league-chemp.csv</code>
        </div>
      </div>
    `;
  }
})();
