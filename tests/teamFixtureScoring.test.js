/**
 * Unit tests for the shared team-fixture scoring helper, extracted from
 * TeamRoundRobinFormat so it can be reused by TeamRoundRobinPlayoffFormat.
 */
const { computeFixtureScoring, buildFixtureResult } = require('../tournament/formats/teamFixtureScoring');

const makeMatch = (overrides = {}) => ({
  participant_a: { type: 'participant', participant_id: 'teamA', name: 'Team A' },
  participant_b: { type: 'participant', participant_id: 'teamB', name: 'Team B' },
  ...overrides,
});

describe('computeFixtureScoring', () => {
  it('awards 1 point per string game won to each side', () => {
    const match = makeMatch();
    const matchResult = {
      winner_id: 'teamA',
      string_results: [
        { string_number: 1, team_a_games: 3, team_b_games: 1 },
        { string_number: 2, team_a_games: 2, team_b_games: 3 },
      ],
      team_a_games_total: 5,
      team_b_games_total: 4,
    };

    const scoring = computeFixtureScoring(match, matchResult);

    // 3+2 = 5 base points for A, 1+3 = 4 base points for B, +2 winner bonus to A
    expect(scoring.aPoints).toBe(7);
    expect(scoring.bPoints).toBe(4);
    expect(scoring.aGamesTotal).toBe(5);
    expect(scoring.bGamesTotal).toBe(4);
  });

  it('gives the submitted winner a 2-point bonus', () => {
    const match = makeMatch();
    const matchResult = {
      winner_id: 'teamB',
      string_results: [{ string_number: 1, team_a_games: 1, team_b_games: 3 }],
      team_a_games_total: 1,
      team_b_games_total: 3,
    };

    const scoring = computeFixtureScoring(match, matchResult);

    expect(scoring.aPoints).toBe(1);
    expect(scoring.bPoints).toBe(5); // 3 base + 2 winner bonus
  });

  it('adds a 1-point play bonus plus games won for a racketball extra', () => {
    const match = makeMatch({
      racketball_result: { team_a_games: 2, team_b_games: 0 },
    });
    const matchResult = {
      winner_id: 'teamA',
      string_results: [],
      team_a_games_total: 2,
      team_b_games_total: 0,
    };

    const scoring = computeFixtureScoring(match, matchResult);

    // racketball: A gets 1 (play bonus) + 2 (games) = 3, B gets 1 (play bonus) + 0 = 1
    // plus +2 winner bonus to A
    expect(scoring.aPoints).toBe(5);
    expect(scoring.bPoints).toBe(1);
  });

  it('adds a 1-point play bonus plus games won for a beginner extra', () => {
    const match = makeMatch({
      beginner_result: { team_a_games: 0, team_b_games: 2 },
    });
    const matchResult = {
      winner_id: 'teamB',
      string_results: [],
      team_a_games_total: 0,
      team_b_games_total: 2,
    };

    const scoring = computeFixtureScoring(match, matchResult);

    expect(scoring.aPoints).toBe(1); // play bonus only
    expect(scoring.bPoints).toBe(5); // 1 play bonus + 2 games + 2 winner bonus
  });

  it('ignores an extra field with no recorded games', () => {
    const match = makeMatch({ racketball_result: {} });
    const matchResult = {
      winner_id: 'teamA',
      string_results: [{ string_number: 1, team_a_games: 3, team_b_games: 0 }],
      team_a_games_total: 3,
      team_b_games_total: 0,
    };

    const scoring = computeFixtureScoring(match, matchResult);

    expect(scoring.aPoints).toBe(5); // 3 base + 2 winner bonus, no extra bonus
    expect(scoring.bPoints).toBe(0);
  });
});

describe('buildFixtureResult', () => {
  it('builds the result sub-document shape from matchResult + scoring', () => {
    const match = makeMatch();
    const matchResult = {
      winner_id: 'teamA',
      winner_name: 'Team A',
      loser_id: 'teamB',
      loser_name: 'Team B',
      string_results: [{ string_number: 1, team_a_games: 3, team_b_games: 1 }],
      team_a_games_total: 3,
      team_b_games_total: 1,
      walkover: false,
    };
    const scoring = computeFixtureScoring(match, matchResult);

    const result = buildFixtureResult(match, matchResult, scoring);

    expect(result).toEqual({
      winner_participant_id: 'teamA',
      winner_name: 'Team A',
      loser_participant_id: 'teamB',
      loser_name: 'Team B',
      string_results: matchResult.string_results,
      team_a_games_total: 3,
      team_b_games_total: 1,
      team_a_league_points: scoring.aPoints,
      team_b_league_points: scoring.bPoints,
      walkover: false,
    });
  });

  it('defaults walkover to false when not provided', () => {
    const match = makeMatch();
    const matchResult = {
      winner_id: 'teamA',
      loser_id: 'teamB',
      string_results: [],
      team_a_games_total: 0,
      team_b_games_total: 0,
    };
    const scoring = computeFixtureScoring(match, matchResult);

    const result = buildFixtureResult(match, matchResult, scoring);

    expect(result.walkover).toBe(false);
  });
});
