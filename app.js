function teamsFromXg(leagueName) {
  if (!xgRaw) return [];

  const root = xgRaw.leagues || xgRaw.data || xgRaw;

  if (Array.isArray(root)) {
    return uniqSorted(
      root
        .filter(r =>
          (r.league === leagueName || r.competition === leagueName) &&
          r.team &&
          !r.team.startsWith("__")
        )
        .map(r => r.team)
    );
  }

  if (root && root[leagueName]) {
    return uniqSorted(
      Object.keys(root[leagueName]).filter(
        k => !k.startsWith("__")
      )
    );
  }

  return [];
}
