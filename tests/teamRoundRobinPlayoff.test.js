/**
 * Unit tests for TeamRoundRobinPlayoffFormat — the fixed 2-division x 4-team
 * "Pint" (places 1-4) / "Half-Pint" (places 5-8) knockout playoff that follows
 * a completed Team Round Robin season.
 */
const TeamRoundRobinPlayoffFormat = require('../tournament/formats/TeamRoundRobinPlayoffFormat');

const makeTeam = (id, name, divisionIndex, seed) => ({
  _id: { toString: () => id },
  name,
  division_index: divisionIndex,
  seed,
});

// Division A (0): 1=A1, 2=A2, 3=A3, 4=A4. Division B (1): 1=B1, 2=B2, 3=B3, 4=B4.
const makeParticipants = () => [
  makeTeam('A1', 'Alpha 1st', 0, 1),
  makeTeam('A2', 'Alpha 2nd', 0, 2),
  makeTeam('A3', 'Alpha 3rd', 0, 3),
  makeTeam('A4', 'Alpha 4th', 0, 4),
  makeTeam('B1', 'Beta 1st', 1, 1),
  makeTeam('B2', 'Beta 2nd', 1, 2),
  makeTeam('B3', 'Beta 3rd', 1, 3),
  makeTeam('B4', 'Beta 4th', 1, 4),
];

const makeMatch = (obj) => ({ ...obj, _id: { toString: () => obj._id } });

const makeFixtureResult = (winnerId, winnerName, loserId, loserName) => ({
  winner_id: winnerId,
  winner_name: winnerName,
  loser_id: loserId,
  loser_name: loserName,
  string_results: [{ string_number: 1, team_a_games: 3, team_b_games: 0 }],
  team_a_games_total: 3,
  team_b_games_total: 0,
});

describe('TeamRoundRobinPlayoffFormat', () => {
  let format;

  beforeEach(() => {
    format = new TeamRoundRobinPlayoffFormat();
  });

  // ─── validateConfig ────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    it('accepts exactly 8 teams, 4 per division, seeded 1-4', () => {
      expect(format.validateConfig({}, makeParticipants()).valid).toBe(true);
    });

    it('rejects fewer than 8 participants', () => {
      const participants = makeParticipants().slice(0, 7);
      expect(format.validateConfig({}, participants).valid).toBe(false);
    });

    it('rejects a division with 5 teams and one with 3', () => {
      const participants = makeParticipants();
      participants[3].division_index = 1; // move Alpha 4th into division B
      expect(format.validateConfig({}, participants).valid).toBe(false);
    });

    it('rejects duplicate seeds within a division', () => {
      const participants = makeParticipants();
      participants[1].seed = 1; // Alpha 2nd now also seed 1
      expect(format.validateConfig({}, participants).valid).toBe(false);
    });

    it('does not reject based on is_pool/player_type — routes.js already filters those out before this is called', () => {
      const participants = makeParticipants();
      participants[0].is_pool = true;
      expect(format.validateConfig({}, participants).valid).toBe(true);
    });
  });

  // ─── generateInitialState ─────────────────────────────────────────────────

  describe('generateInitialState', () => {
    let matches;

    beforeEach(() => {
      ({ matches } = format.generateInitialState({}, makeParticipants()));
    });

    it('generates exactly 8 matches', () => {
      expect(matches).toHaveLength(8);
    });

    it('pairs Pint semis by cross-division 1st/2nd', () => {
      const sfA = matches.find((m) => m.match_number === 'PINT-SF-A');
      const sfB = matches.find((m) => m.match_number === 'PINT-SF-B');
      expect(sfA.participant_a.name).toBe('Alpha 1st');
      expect(sfA.participant_b.name).toBe('Beta 2nd');
      expect(sfB.participant_a.name).toBe('Alpha 2nd');
      expect(sfB.participant_b.name).toBe('Beta 1st');
      expect(sfA.status).toBe('ready');
      expect(sfB.status).toBe('ready');
      expect(sfA.stage).toBe('main');
    });

    it('pairs Half-Pint semis by cross-division 3rd/4th', () => {
      const sfA = matches.find((m) => m.match_number === 'HP-SF-A');
      const sfB = matches.find((m) => m.match_number === 'HP-SF-B');
      expect(sfA.participant_a.name).toBe('Alpha 3rd');
      expect(sfA.participant_b.name).toBe('Beta 4th');
      expect(sfB.participant_a.name).toBe('Alpha 4th');
      expect(sfB.participant_b.name).toBe('Beta 3rd');
      expect(sfA.stage).toBe('plate');
    });

    it('creates TBD pending placeholders for finals and consolation matches', () => {
      ['PINT-F', 'PINT-3V4', 'HP-F', 'HP-7V8'].forEach((matchNumber) => {
        const m = matches.find((mm) => mm.match_number === matchNumber);
        expect(m.status).toBe('pending');
        expect(m.participant_a.type).toBe('tbd');
        expect(m.participant_b.type).toBe('tbd');
        expect(m.round).toBe(2);
      });
    });
  });

  // ─── onMatchResult: bracket advancement ───────────────────────────────────

  describe('onMatchResult advancement', () => {
    let state, allMatches;

    beforeEach(() => {
      const initial = format.generateInitialState({}, makeParticipants());
      state = initial.state;
      allMatches = initial.matches.map((m, i) => makeMatch({ ...m, _id: `m${i + 1}` }));
    });

    it('fills the winner and loser slots of PINT-F / PINT-3V4 after PINT-SF-A completes', () => {
      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      const result = format.onMatchResult(
        state,
        sfA,
        makeFixtureResult('A1', 'Alpha 1st', 'B2', 'Beta 2nd'),
        [],
        allMatches
      );

      const pintF = result.updatedMatches.find((m) => m.match_number === 'PINT-F');
      const pint34 = result.updatedMatches.find((m) => m.match_number === 'PINT-3V4');

      expect(pintF.participant_a.participant_id).toBe('A1');
      expect(pintF.status).toBe('pending'); // slot b still TBD (SF-B not played)
      expect(pint34.participant_a.participant_id).toBe('B2');
      expect(pint34.status).toBe('pending');
    });

    it('marks PINT-F and PINT-3V4 ready once both semis are complete', () => {
      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      const afterA = format.onMatchResult(
        state,
        sfA,
        makeFixtureResult('A1', 'Alpha 1st', 'B2', 'Beta 2nd'),
        [],
        allMatches
      );

      // Merge SF-A's outcome into allMatches before processing SF-B, as the route would.
      const mergedAfterA = allMatches.map((m) => {
        const updated = afterA.updatedMatches.find((u) => u.match_number === m.match_number);
        return updated ? { ...m, ...updated } : m;
      });

      const sfB = mergedAfterA.find((m) => m.match_number === 'PINT-SF-B');
      const afterB = format.onMatchResult(
        afterA.state,
        sfB,
        makeFixtureResult('B1', 'Beta 1st', 'A2', 'Alpha 2nd'),
        [],
        mergedAfterA
      );

      const pintF = afterB.updatedMatches.find((m) => m.match_number === 'PINT-F');
      const pint34 = afterB.updatedMatches.find((m) => m.match_number === 'PINT-3V4');

      expect(pintF.status).toBe('ready');
      expect(pintF.participant_a.participant_id).toBe('A1');
      expect(pintF.participant_b.participant_id).toBe('B1');
      expect(pint34.status).toBe('ready');
      expect(pint34.participant_a.participant_id).toBe('B2');
      expect(pint34.participant_b.participant_id).toBe('A2');
    });
  });

  // ─── Full bracket playthrough ──────────────────────────────────────────────

  describe('full bracket playthrough', () => {
    it('produces correct 1st-8th final placements and marks the tournament complete', () => {
      const initial = format.generateInitialState({}, makeParticipants());
      let state = initial.state;
      let allMatches = initial.matches.map((m, i) => makeMatch({ ...m, _id: `m${i + 1}` }));

      const play = (matchNumber, winnerId, winnerName, loserId, loserName) => {
        const match = allMatches.find((m) => m.match_number === matchNumber);
        const outcome = format.onMatchResult(
          state,
          match,
          makeFixtureResult(winnerId, winnerName, loserId, loserName),
          [],
          allMatches
        );
        state = outcome.state;
        allMatches = allMatches.map((m) => {
          const updated = outcome.updatedMatches.find((u) => u.match_number === m.match_number);
          return updated ? { ...m, ...updated } : m;
        });
        return outcome;
      };

      play('PINT-SF-A', 'A1', 'Alpha 1st', 'B2', 'Beta 2nd');
      play('PINT-SF-B', 'B1', 'Beta 1st', 'A2', 'Alpha 2nd');
      play('HP-SF-A', 'A3', 'Alpha 3rd', 'B4', 'Beta 4th');
      play('HP-SF-B', 'B3', 'Beta 3rd', 'A4', 'Alpha 4th');

      play('PINT-F', 'A1', 'Alpha 1st', 'B1', 'Beta 1st');
      play('PINT-3V4', 'B2', 'Beta 2nd', 'A2', 'Alpha 2nd');
      play('HP-F', 'A3', 'Alpha 3rd', 'B3', 'Beta 3rd');
      const final = play('HP-7V8', 'A4', 'Alpha 4th', 'B4', 'Beta 4th');

      expect(final.tournamentComplete).toBe(true);
      expect(format.isComplete(final.state)).toBe(true);
      expect(format.getFinalResults(final.state)).toEqual([
        { position: 1, participant_id: 'A1', name: 'Alpha 1st' },
        { position: 2, participant_id: 'B1', name: 'Beta 1st' },
        { position: 3, participant_id: 'B2', name: 'Beta 2nd' },
        { position: 4, participant_id: 'A2', name: 'Alpha 2nd' },
        { position: 5, participant_id: 'A3', name: 'Alpha 3rd' },
        { position: 6, participant_id: 'B3', name: 'Beta 3rd' },
        { position: 7, participant_id: 'A4', name: 'Alpha 4th' },
        { position: 8, participant_id: 'B4', name: 'Beta 4th' },
      ]);
    });
  });

  // ─── Edit-safety ────────────────────────────────────────────────────────────

  describe('editing a completed semi-final result', () => {
    let state, allMatches, afterFirstSubmission;

    beforeEach(() => {
      const initial = format.generateInitialState({}, makeParticipants());
      state = initial.state;
      allMatches = initial.matches.map((m, i) => makeMatch({ ...m, _id: `m${i + 1}` }));

      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      afterFirstSubmission = format.onMatchResult(
        state,
        sfA,
        makeFixtureResult('A1', 'Alpha 1st', 'B2', 'Beta 2nd'),
        [],
        allMatches
      );
      allMatches = allMatches.map((m) => {
        const updated = afterFirstSubmission.updatedMatches.find((u) => u.match_number === m.match_number);
        return updated ? { ...m, ...updated } : m;
      });
      state = afterFirstSubmission.state;
    });

    it('is a no-op when the same winner is resubmitted', () => {
      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      expect(() =>
        format.onMatchResult(state, sfA, makeFixtureResult('A1', 'Alpha 1st', 'B2', 'Beta 2nd'), [], allMatches)
      ).not.toThrow();
    });

    it('rewires the downstream slot when the winner changes before the final is played', () => {
      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      const outcome = format.onMatchResult(
        state,
        sfA,
        makeFixtureResult('B2', 'Beta 2nd', 'A1', 'Alpha 1st'),
        [],
        allMatches
      );
      const pintF = outcome.updatedMatches.find((m) => m.match_number === 'PINT-F');
      const pint34 = outcome.updatedMatches.find((m) => m.match_number === 'PINT-3V4');
      expect(pintF.participant_a.participant_id).toBe('B2');
      expect(pint34.participant_a.participant_id).toBe('A1');
    });

    it('throws a BRACKET_LOCKED error when the winner changes after the final has been played', () => {
      // Complete PINT-SF-B, then PINT-F, so PINT-F is now played.
      const sfB = allMatches.find((m) => m.match_number === 'PINT-SF-B');
      const afterB = format.onMatchResult(
        state,
        sfB,
        makeFixtureResult('B1', 'Beta 1st', 'A2', 'Alpha 2nd'),
        [],
        allMatches
      );
      allMatches = allMatches.map((m) => {
        const updated = afterB.updatedMatches.find((u) => u.match_number === m.match_number);
        return updated ? { ...m, ...updated } : m;
      });
      state = afterB.state;

      const pintF = allMatches.find((m) => m.match_number === 'PINT-F');
      const afterFinal = format.onMatchResult(
        state,
        pintF,
        makeFixtureResult('A1', 'Alpha 1st', 'B1', 'Beta 1st'),
        [],
        allMatches
      );
      allMatches = allMatches.map((m) => {
        const updated = afterFinal.updatedMatches.find((u) => u.match_number === m.match_number);
        return updated ? { ...m, ...updated } : m;
      });
      state = afterFinal.state;

      const sfA = allMatches.find((m) => m.match_number === 'PINT-SF-A');
      let caught;
      try {
        format.onMatchResult(state, sfA, makeFixtureResult('B2', 'Beta 2nd', 'A1', 'Alpha 1st'), [], allMatches);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe('BRACKET_LOCKED');
    });
  });

  // ─── getNextPlayableMatches / isComplete ───────────────────────────────────

  describe('getNextPlayableMatches', () => {
    it('returns only matches with status ready', () => {
      const { matches } = format.generateInitialState({}, makeParticipants());
      const playable = format.getNextPlayableMatches({}, matches);
      expect(playable.map((m) => m.match_number).sort()).toEqual(
        ['HP-SF-A', 'HP-SF-B', 'PINT-SF-A', 'PINT-SF-B'].sort()
      );
    });
  });

  describe('isComplete', () => {
    it('is false for a fresh tournament', () => {
      const { state } = format.generateInitialState({}, makeParticipants());
      expect(format.isComplete(state)).toBe(false);
    });
  });
});
