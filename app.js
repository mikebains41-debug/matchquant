const H_att = clamp(H.att, 0.3, 2.5);
        const H_def = clamp(H.def, 0.3, 2.5);
        const A_att = clamp(A.att, 0.3, 2.5);
        const A_def = clamp(A.def, 0.3, 2.5);

        // Convert your att/def strength to match xG (simple symmetric mapping)
        // Home xG increases with home attack and away defense weakness (higher def = worse)
        const xgHome = baseGoals * H_att * (A_def);
        const xgAway = baseGoals * A_att * (H_def);

        // Cards/Corners (team or league avg)
        const CC_H = getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, ccHomeKey);
        const CC_A = getTeamCcOrLeagueAvg(cardsCorners, leagueCcAvg, league, ccAwayKey);

        // If still no CC data for league, use global defaults
        const fallbackCC = { cards_for: 2.2, cards_against: 2.2, corners_for: 5.0, corners_against: 5.0 };

        const hcc = CC_H || fallbackCC;
        const acc = CC_A || fallbackCC;

        // Expected team cards = avg(team cards_for, opponent cards_against)
        const cardsHome = (Number(hcc.cards_for) + Number(acc.cards_against)) / 2;
        const cardsAway = (Number(acc.cards_for) + Number(hcc.cards_against)) / 2;

        // Expected team corners = avg(team corners_for, opponent corners_against)
        const cornersHome = (Number(hcc.corners_for) + Number(acc.corners_against)) / 2;
        const cornersAway = (Number(acc.corners_for) + Number(hcc.corners_against)) / 2;

        const sims = parseInt(el.sims?.value || "10000", 10);

        const out = engine({
          league,
          homeTeam: home,
          awayTeam: away,
          sims,

          xgHome,
          xgAway,
          leagueMult,
          homeAdv,
          goalCap,

          cardsHome,
          cardsAway,
          cornersHome,
          cornersAway,
        });

        const most = out.mostLikely;
        const html = `
          <div class="card">
            <h2>${home} vs ${away}</h2>
            <div style="opacity:.85">${league} • λH=${fmtNum(out.lamH,2)} • λA=${fmtNum(out.lamA,2)}</div>

            <div class="pill">Most likely: ${most.h}-${most.a} (${toPct(most.p)})</div>

            <div class="pill">O2.5: ${toPct(out.ou25.over)} (fair ${fairOdds(out.ou25.over)})</div>
            <div class="pill">U2.5: ${toPct(out.ou25.under)} (fair ${fairOdds(out.ou25.under)})</div>

            <div class="pill">BTTS Yes: ${toPct(out.btts.yes)} (fair ${fairOdds(out.btts.yes)})</div>
            <div class="pill">BTTS No: ${toPct(out.btts.no)} (fair ${fairOdds(out.btts.no)})</div>

            <hr style="opacity:.15;margin:14px 0">

            <h3>1X2 (model)</h3>
            <div>Home: ${toPct(out.x12.home)} (fair ${fairOdds(out.x12.home)})</div>
            <div>Draw: ${toPct(out.x12.draw)} (fair ${fairOdds(out.x12.draw)})</div>
            <div>Away: ${toPct(out.x12.away)} (fair ${fairOdds(out.x12.away)})</div>

            <hr style="opacity:.15;margin:14px 0">

            <h3>Cards & Corners (model)</h3>
            <div style="opacity:.85">Team Cards (inputs): Home ${fmtNum(cardsHome,2)} • Away ${fmtNum(cardsAway,2)}</div>
            <div style="opacity:.85">Team Corners (inputs): Home ${fmtNum(cornersHome,2)} • Away ${fmtNum(cornersAway,2)}</div>

            <div style="margin-top:10px">
              <div>Total Cards λ: <b>${fmtNum(out.cards.lambdaTotal,2)}</b> • Most likely total: <b>${out.cards.mostLikelyTotal.k}</b></div>
              <div>O4.5: ${toPct(out.cards.ou45.over)} (fair ${fairOdds(out.cards.ou45.over)}) •
                   U4.5: ${toPct(out.cards.ou45.under)} (fair ${fairOdds(out.cards.ou45.under)})</div>
            </div>

            <div style="margin-top:10px">
              <div>Total Corners λ: <b>${fmtNum(out.corners.lambdaTotal,2)}</b> • Most likely total: <b>${out.corners.mostLikelyTotal.k}</b></div>
              <div>O9.5: ${toPct(out.corners.ou95.over)} (fair ${fairOdds(out.corners.ou95.over)}) •
                   U9.5: ${toPct(out.corners.ou95.under)} (fair ${fairOdds(out.corners.ou95.under)})</div>
            </div>

            <div style="opacity:.75;margin-top:12px;font-size:.9em">
              xG key used: Home=${xgHomeKey} ${H.found ? "" : "(LEAGUE AVG)"} • Away=${xgAwayKey} ${A.found ? "" : "(LEAGUE AVG)"}<br>
              Cards/Corners key used: Home=${ccHomeKey} ${CC_H?.found ? "" : "(LEAGUE AVG)"} • Away=${ccAwayKey} ${CC_A?.found ? "" : "(LEAGUE AVG)"}
            </div>
          </div>
        `;

        setResults(html);
        status("Done.");
      });

      status("Ready.");
      setResults(`<div style="opacity:.85">Select a league and teams, then press <b>Run Prediction</b>.</div>`);
      updateTeams();

    } catch (err) {
      console.error(err);
      status("Error: " + err.message);
      setResults(`<b>Error:</b> ${err.message}<br><br>
        <div style="opacity:.85">Open Chrome → ⋮ → Developer tools (or try desktop) and check Console.</div>
      `);
    }
  }

  init();
})();
