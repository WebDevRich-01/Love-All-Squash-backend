/**
 * Unit tests for TeamRoundRobinFormat — added as a regression safety net around
 * the refactor that extracted fixture scoring into teamFixtureScoring.js.
 */
const TeamRoundRobinFormat = require('../tournament/formats/TeamRoundRobinFormat');

const makeTeam = (id, name, divisionIndex) => ({
  _id: { toString: () => id },
  name,
  division_index: divisionIndex,
});

describe('TeamRoundRobinFormat', () => {
  let format;

  beforeEach(() => {
    format = new TeamRoundRobinFormat();
  });

  describe('validateConfig', () => {
    it('rejects fewer than 2 teams per division', () => {
      const result = format.validateConfig({ divisions: { count: 2 } }, [makeTeam('1', 'A', 0)]);
      expect(result.valid).toBe(false);
    });

    it('accepts 4 teams across 2 divisions', () => {
      const participants = [
        makeTeam('1', 'A', 0),
        makeTeam('2', 'B', 0),
        makeTeam('3', 'C', 1),
        makeTeam('4', 'D', 1),
      ];
      expect(format.validateConfig({ divisions: { count: 2 } }, participants).valid).toBe(true);
    });
  });

  describe('generateInitialState', () => {
    it('generates one all-play-all fixture per pair within each division', () => {
      const participants = [
        makeTeam('1', 'A', 0),
        makeTeam('2', 'B', 0),
        makeTeam('3', 'C', 1),
        makeTeam('4', 'D', 1),
      ];
      const { matches, groups } = format.generateInitialState({ divisions: { count: 2 } }, participants);

      expect(groups).toHaveLength(2);
      expect(matches).toHaveLength(2); // 1 fixture per 2-team division x 2 divisions
      matches.forEach((m) => expect(m.status).toBe('ready'));
    });
  });

  describe('onMatchResult', () => {
    it('computes league points and standings from string results', () => {
      const participants = [makeTeam('1', 'Team A', 0), makeTeam('2', 'Team B', 0)];
      const { state, matches, groups } = format.generateInitialState({ divisions: { count: 1 } }, participants);

      const group = { ...groups[0], _id: 'div_a', participant_ids: ['1', '2'], standings: [] };
      const matchDoc = { ...matches[0], _id: 'm1' };

      const matchResult = {
        winner_id: '1',
        winner_name: 'Team A',
        loser_id: '2',
        loser_name: 'Team B',
        string_results: [
          { string_number: 1, team_a_games: 3, team_b_games: 1 },
          { string_number: 2, team_a_games: 2, team_b_games: 3 },
        ],
        team_a_games_total: 5,
        team_b_games_total: 4,
      };

      const result = format.onMatchResult(state, matchDoc, matchResult, [group], [matchDoc]);

      const updated = result.updatedMatches[0];
      expect(updated.status).toBe('completed');
      expect(updated.result.team_a_league_points).toBe(7); // 5 base + 2 winner bonus
      expect(updated.result.team_b_league_points).toBe(4);

      const standings = result.standingsUpdates[0].standings;
      const teamA = standings.find((s) => s.participant_id === '1');
      expect(teamA.position).toBe(1);
      expect(teamA.wins).toBe(1);
      expect(result.tournamentComplete).toBe(true);
    });
  });
});
