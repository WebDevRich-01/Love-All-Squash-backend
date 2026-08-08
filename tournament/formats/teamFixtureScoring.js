/**
 * Shared per-fixture scoring for team-based tournament formats.
 *
 * A "fixture" between two teams consists of multiple individual string matches
 * (plus optional racketball/beginner extras). The fixture winner is whichever
 * team is submitted as winner_id; this module computes each side's league-style
 * points from the string/extra results. Shared by TeamRoundRobinFormat and
 * TeamRoundRobinPlayoffFormat so fixture scoring stays identical everywhere.
 */

function computeFixtureScoring(tournamentMatch, matchResult) {
  const aId = tournamentMatch.participant_a.participant_id?.toString();
  const bId = tournamentMatch.participant_b.participant_id?.toString();
  const winnerId = matchResult.winner_id?.toString();

  const aGamesTotal = matchResult.team_a_games_total ?? 0;
  const bGamesTotal = matchResult.team_b_games_total ?? 0;

  // 1 point per squash game won across all string matches
  let aPoints = 0, bPoints = 0;
  (matchResult.string_results || []).forEach((s) => {
    aPoints += s.team_a_games || 0;
    bPoints += s.team_b_games || 0;
  });

  // Extra matches: both teams get 1 bonus point for playing + points per game won
  for (const field of ['racketball_result', 'beginner_result']) {
    const r = tournamentMatch[field];
    if (r?.team_a_games != null) {
      aPoints += 1 + (r.team_a_games || 0);
      bPoints += 1 + (r.team_b_games || 0);
    }
  }

  // 2 bonus points for the overall fixture winner (most total games inc. extras)
  if (winnerId === aId) aPoints += 2;
  else if (winnerId === bId) bPoints += 2;

  return { aPoints, bPoints, aGamesTotal, bGamesTotal };
}

function buildFixtureResult(tournamentMatch, matchResult, scoring) {
  return {
    winner_participant_id: matchResult.winner_id?.toString(),
    winner_name: matchResult.winner_name,
    loser_participant_id: matchResult.loser_id,
    loser_name: matchResult.loser_name,
    string_results: matchResult.string_results || [],
    team_a_games_total: scoring.aGamesTotal,
    team_b_games_total: scoring.bGamesTotal,
    team_a_league_points: scoring.aPoints,
    team_b_league_points: scoring.bPoints,
    walkover: matchResult.walkover || false,
  };
}

module.exports = { computeFixtureScoring, buildFixtureResult };
