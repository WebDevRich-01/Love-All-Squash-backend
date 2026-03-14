/**
 * Unit tests for SingleEliminationFormat.
 */
const SingleEliminationFormat = require('../tournament/formats/SingleEliminationFormat');

const makeParticipant = (id, name, seed) => ({
  _id: { toString: () => id },
  name,
  seed,
});

const makeResult = (winnerId, loserId, winnerName = 'W', loserName = 'L') => ({
  winner_id: winnerId,
  winner_name: winnerName,
  loser_id: loserId,
  loser_name: loserName,
  game_scores: [],
  walkover: false,
});

const makeMatch = (obj) => ({
  ...obj,
  _id: { toString: () => obj._id },
  toObject: () => obj,
});

describe('SingleEliminationFormat', () => {
  let format;

  beforeEach(() => {
    format = new SingleEliminationFormat();
  });

  // ─── validateConfig ────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    it('rejects fewer than 2 participants', () => {
      const result = format.validateConfig({}, [makeParticipant('1', 'A', 1)]);
      expect(result.valid).toBe(false);
    });

    it('accepts 8 participants', () => {
      const participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      expect(format.validateConfig({}, participants).valid).toBe(true);
    });

    it('rejects duplicate seeds', () => {
      const participants = [
        makeParticipant('1', 'A', 1),
        makeParticipant('2', 'B', 1), // duplicate seed 1
        makeParticipant('3', 'C', 2),
        makeParticipant('4', 'D', 3),
      ];
      const result = format.validateConfig({}, participants);
      expect(result.valid).toBe(false);
    });
  });

  // ─── generateInitialState ─────────────────────────────────────────────────

  describe('generateInitialState for 8 players', () => {
    let participants;
    let result;

    beforeEach(() => {
      participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      result = format.generateInitialState({}, participants);
    });

    it('generates 7 total matches (4 R1 + 2 R2 + 1 R3) for 8-player draw', () => {
      expect(result.matches.length).toBe(7);
      expect(result.matches.filter((m) => m.round === 1).length).toBe(4);
      expect(result.matches.filter((m) => m.round === 2).length).toBe(2);
      expect(result.matches.filter((m) => m.round === 3).length).toBe(1);
    });

    it('sets drawSize to 8', () => {
      expect(result.state.drawSize).toBe(8);
    });

    it('sets totalRounds to 3', () => {
      expect(result.state.totalRounds).toBe(3);
    });

    it('all Round 1 matches are ready, later rounds are pending (no byes for exact power-of-2 draw)', () => {
      expect(result.matches.filter((m) => m.round === 1).every((m) => m.status === 'ready')).toBe(true);
      expect(result.matches.filter((m) => m.round > 1).every((m) => m.status === 'pending')).toBe(true);
    });
  });

  describe('generateInitialState for 16 players', () => {
    it('generates 15 total matches (8+4+2+1) for 16-player draw', () => {
      const participants = Array.from({ length: 16 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      const result = format.generateInitialState({}, participants);
      expect(result.matches.length).toBe(15);
      expect(result.matches.filter((m) => m.round === 1).length).toBe(8);
      expect(result.state.totalRounds).toBe(4);
    });
  });

  describe('generateInitialState with byes (6 players)', () => {
    it('adds byes to reach 8-player draw', () => {
      const participants = Array.from({ length: 6 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      const result = format.generateInitialState({}, participants);
      expect(result.state.drawSize).toBe(8);
      expect(result.state.byeCount).toBe(2);

      const byeMatches = result.matches.filter(
        (m) =>
          m.participant_a.type === 'bye' || m.participant_b.type === 'bye'
      );
      expect(byeMatches.length).toBe(2);
      byeMatches.forEach((m) => expect(m.status).toBe('completed'));
    });
  });

  // ─── _isRoundComplete ─────────────────────────────────────────────────────

  describe('_isRoundComplete', () => {
    it('returns false when some matches are still ready', () => {
      const matches = [
        { round: 1, stage: 'main', status: 'completed' },
        { round: 1, stage: 'main', status: 'ready' },
        { round: 2, stage: 'main', status: 'ready' },
      ];
      expect(format._isRoundComplete(1, matches)).toBe(false);
    });

    it('returns true when all matches in the round are completed', () => {
      const matches = [
        { round: 1, stage: 'main', status: 'completed' },
        { round: 1, stage: 'main', status: 'completed' },
        { round: 2, stage: 'main', status: 'ready' },
      ];
      expect(format._isRoundComplete(1, matches)).toBe(true);
    });

    it('returns true for walkover matches', () => {
      const matches = [
        { round: 1, stage: 'main', status: 'walkover' },
        { round: 1, stage: 'main', status: 'completed' },
      ];
      expect(format._isRoundComplete(1, matches)).toBe(true);
    });

    it('returns false for empty match list', () => {
      expect(format._isRoundComplete(1, [])).toBe(false);
    });
  });

  // ─── onMatchResult ────────────────────────────────────────────────────────

  describe('onMatchResult', () => {
    it('marks the match as completed and advances winner', () => {
      const participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      const { state, matches } = format.generateInitialState({}, participants);

      const matchDoc = makeMatch({
        ...matches[0],
        _id: 'm1',
        status: 'ready',
        match_number: 'R1M1',
        participant_a: { type: 'participant', participant_id: '1', name: 'P1' },
        participant_b: { type: 'participant', participant_id: '8', name: 'P8' },
      });

      const allMatches = matches.map((m, i) =>
        makeMatch({ ...m, _id: `m${i + 1}` })
      );

      const result = format.onMatchResult(
        state,
        matchDoc,
        makeResult('1', '8', 'P1', 'P8'),
        [],
        allMatches
      );

      const completedMatch = result.updatedMatches.find(
        (m) => m._id?.toString() === 'm1'
      );
      expect(completedMatch.status).toBe('completed');
      expect(completedMatch.result.winner_participant_id).toBe('1');
    });

    it('does not advance currentRound when round is not complete', () => {
      const participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      const { state, matches } = format.generateInitialState({}, participants);

      // Only submit 1 of 4 Round 1 matches
      const matchDoc = makeMatch({
        ...matches[0],
        _id: 'm1',
        status: 'ready',
        match_number: 'R1M1',
        participant_a: { type: 'participant', participant_id: '1', name: 'P1' },
        participant_b: { type: 'participant', participant_id: '8', name: 'P8' },
      });

      const allMatches = matches.map((m, i) =>
        makeMatch({ ...m, _id: `m${i + 1}` })
      );

      const result = format.onMatchResult(
        state,
        matchDoc,
        makeResult('1', '8', 'P1', 'P8'),
        [],
        allMatches
      );

      expect(result.state.currentRound).toBe(1);
    });

    it('advances currentRound when all Round 1 matches complete', () => {
      const participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `P${i + 1}`, i + 1)
      );
      const { state, matches } = format.generateInitialState({}, participants);

      const allMatchObjs = matches.map((m, i) => ({ ...m, _id: `m${i + 1}` }));

      let currentState = state;
      let lastResult;

      for (let i = 0; i < 4; i++) {
        const m = allMatchObjs[i];
        const matchDoc = makeMatch({ ...m, status: 'ready' });

        // Previous matches are completed, remaining ones are ready
        const effectiveAll = allMatchObjs.map((am, j) =>
          makeMatch({
            ...am,
            status: j < i ? 'completed' : j === i ? 'ready' : 'ready',
          })
        );

        lastResult = format.onMatchResult(
          currentState,
          matchDoc,
          makeResult(m.participant_a.participant_id, m.participant_b.participant_id),
          [],
          effectiveAll
        );
        currentState = lastResult.state;
      }

      expect(lastResult.state.currentRound).toBe(2);
    });
  });
});
