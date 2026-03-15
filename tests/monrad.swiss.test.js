/**
 * Unit tests for MonradFormat — true Swiss pairing engine.
 */
const MonradFormat = require('../tournament/formats/MonradFormat');

// Helper: create a participant-like object
const makeParticipant = (id, name, seed) => ({
  _id: { toString: () => id },
  name,
  seed,
});

// Helper: create a fake match result
const makeResult = (winnerId, loserId, winnerName = 'W', loserName = 'L', gameScores = []) => ({
  winner_id: winnerId,
  winner_name: winnerName,
  loser_id: loserId,
  loser_name: loserName,
  game_scores: gameScores,
  walkover: false,
});

// Helper: create a fake TournamentMatch document
const makeMatch = (matchObj) => ({
  ...matchObj,
  _id: { toString: () => matchObj._id },
  toObject: () => matchObj,
  round: matchObj.round,
  status: matchObj.status,
  match_number: matchObj.match_number,
  participant_a: matchObj.participant_a,
  participant_b: matchObj.participant_b,
  result: matchObj.result,
});

describe('MonradFormat', () => {
  let format;

  beforeEach(() => {
    format = new MonradFormat();
  });

  // ─── validateConfig ────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    it('rejects fewer than 4 participants', () => {
      const result = format.validateConfig({}, [
        makeParticipant('1', 'A', 1),
        makeParticipant('2', 'B', 2),
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('accepts 4–32 participants', () => {
      const participants = Array.from({ length: 8 }, (_, i) =>
        makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
      );
      const result = format.validateConfig({}, participants);
      expect(result.valid).toBe(true);
    });

    it('rejects more than 32 participants', () => {
      const participants = Array.from({ length: 33 }, (_, i) =>
        makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
      );
      const result = format.validateConfig({}, participants);
      expect(result.valid).toBe(false);
    });
  });

  // ─── generateInitialState ─────────────────────────────────────────────────

  describe('generateInitialState', () => {
    describe('8 players (even draw)', () => {
      let participants;
      let result;

      beforeEach(() => {
        participants = Array.from({ length: 8 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        result = format.generateInitialState({}, participants);
      });

      it('generates 4 Round 1 matches', () => {
        expect(result.matches.length).toBe(4);
      });

      it('all Round 1 matches are ready', () => {
        expect(result.matches.every((m) => m.status === 'ready')).toBe(true);
      });

      it('pairs by top-vs-bottom seeding (1v8, 2v7, 3v6, 4v5)', () => {
        const pairs = result.matches.map((m) => [
          m.participant_a.name,
          m.participant_b.name,
        ]);
        expect(pairs[0]).toEqual(['Player 1', 'Player 8']);
        expect(pairs[1]).toEqual(['Player 2', 'Player 7']);
        expect(pairs[2]).toEqual(['Player 3', 'Player 6']);
        expect(pairs[3]).toEqual(['Player 4', 'Player 5']);
      });

      it('sets correct totalRounds', () => {
        expect(result.state.totalRounds).toBe(3); // ceil(log2(8)) = 3
      });

      it('all players start at 0 wins, 0 losses', () => {
        result.state.players.forEach((p) => {
          expect(p.wins).toBe(0);
          expect(p.losses).toBe(0);
        });
      });
    });

    describe('7 players (odd draw — bye required)', () => {
      let participants;
      let result;

      beforeEach(() => {
        participants = Array.from({ length: 7 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        result = format.generateInitialState({}, participants);
      });

      it('generates 4 matches (3 real + 1 bye)', () => {
        expect(result.matches.length).toBe(4);
      });

      it('exactly one bye match, auto-completed', () => {
        const byeMatches = result.matches.filter(
          (m) => m.participant_b.type === 'bye'
        );
        expect(byeMatches.length).toBe(1);
        expect(byeMatches[0].status).toBe('completed');
      });

      it('bye goes to lowest-seeded player (seed 7)', () => {
        const byeMatch = result.matches.find(
          (m) => m.participant_b.type === 'bye'
        );
        expect(byeMatch.participant_a.name).toBe('Player 7');
      });

      it('bye player gets 1 win and 1 bye count in state', () => {
        const byePlayer = result.state.players.find(
          (p) => p.name === 'Player 7'
        );
        expect(byePlayer.wins).toBe(1);
        expect(byePlayer.byes).toBe(1);
      });
    });

    describe('9 players (odd draw)', () => {
      let result;

      beforeEach(() => {
        const participants = Array.from({ length: 9 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        result = format.generateInitialState({}, participants);
      });

      it('generates 5 matches for 9 players', () => {
        expect(result.matches.length).toBe(5);
      });

      it('one bye match present', () => {
        const byeMatches = result.matches.filter(
          (m) => m.participant_b.type === 'bye'
        );
        expect(byeMatches.length).toBe(1);
      });
    });

    describe('16 players', () => {
      it('generates 8 Round 1 matches and 4 total rounds', () => {
        const participants = Array.from({ length: 16 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const result = format.generateInitialState({}, participants);
        expect(result.matches.length).toBe(8);
        expect(result.state.totalRounds).toBe(4);
      });
    });
  });

  // ─── onMatchResult ────────────────────────────────────────────────────────

  describe('onMatchResult', () => {
    describe('round not yet complete', () => {
      it('returns updated state but no new matches', () => {
        const participants = Array.from({ length: 8 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const { state, matches } = format.generateInitialState({}, participants);

        // Submit result for first match only (round has 4 matches)
        const match1 = makeMatch({
          ...matches[0],
          _id: 'match1',
          status: 'ready',
          participant_a: { type: 'participant', participant_id: '1', name: 'Player 1' },
          participant_b: { type: 'participant', participant_id: '2', name: 'Player 2' },
        });

        // allMatches: 4 matches, 3 still ready
        const allMatches = matches.map((m, i) =>
          makeMatch({ ...m, _id: `match${i + 1}` })
        );

        const result = format.onMatchResult(
          state,
          match1,
          makeResult('1', '2', 'Player 1', 'Player 2'),
          [],
          allMatches
        );

        expect(result.newMatches.length).toBe(0);
        expect(result.state.currentRound).toBe(1);
        expect(result.tournamentComplete).toBe(false);
      });
    });

    describe('round complete triggers next round generation', () => {
      it('generates Round 2 matches after all Round 1 results submitted', () => {
        const participants = Array.from({ length: 8 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const { state: initState, matches: initMatches } = format.generateInitialState({}, participants);

        // Simulate all 4 Round 1 results
        const allMatchObjs = initMatches.map((m, i) => ({
          ...m,
          _id: `match${i + 1}`,
        }));

        let currentState = initState;
        let lastResult;

        for (let i = 0; i < 4; i++) {
          const m = allMatchObjs[i];
          const matchDoc = makeMatch({ ...m, status: 'ready' });
          const winnerId = m.participant_a.participant_id;
          const loserId = m.participant_b.participant_id;

          // Build effective allMatches: mark previous completed, this one ready
          const effectiveAll = allMatchObjs.map((am, j) => {
            if (j < i) {
              return makeMatch({ ...am, status: 'completed' });
            }
            return makeMatch({ ...am, status: j === i ? 'ready' : 'ready' });
          });

          lastResult = format.onMatchResult(
            currentState,
            matchDoc,
            makeResult(winnerId, loserId),
            [],
            effectiveAll
          );
          currentState = lastResult.state;
        }

        // After the last result, Round 2 should be generated
        expect(lastResult.newMatches.length).toBe(4);
        expect(lastResult.state.currentRound).toBe(2);
      });
    });

    describe('player stats update correctly', () => {
      it('winner gets +1 win, loser gets +1 loss', () => {
        const participants = Array.from({ length: 8 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const { state, matches } = format.generateInitialState({}, participants);

        const match1 = makeMatch({
          ...matches[0],
          _id: 'match1',
          participant_a: { type: 'participant', participant_id: '1', name: 'Player 1' },
          participant_b: { type: 'participant', participant_id: '2', name: 'Player 2' },
        });

        const allMatches = matches.map((m, i) => makeMatch({ ...m, _id: `match${i + 1}` }));

        const result = format.onMatchResult(
          state,
          match1,
          makeResult('1', '2', 'Player 1', 'Player 2', [
            { player1: 15, player2: 11 },
            { player1: 15, player2: 9 },
            { player1: 15, player2: 7 },
          ]),
          [],
          allMatches
        );

        const winner = result.state.players.find((p) => p.id === '1');
        const loser = result.state.players.find((p) => p.id === '2');

        expect(winner.wins).toBe(1);
        expect(winner.losses).toBe(0);
        expect(loser.wins).toBe(0);
        expect(loser.losses).toBe(1);
      });

      it('opponent history is updated after match', () => {
        const participants = Array.from({ length: 8 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const { state, matches } = format.generateInitialState({}, participants);

        const match1 = makeMatch({
          ...matches[0],
          _id: 'match1',
          participant_a: { type: 'participant', participant_id: '1', name: 'Player 1' },
          participant_b: { type: 'participant', participant_id: '2', name: 'Player 2' },
        });

        const allMatches = matches.map((m, i) => makeMatch({ ...m, _id: `match${i + 1}` }));
        const result = format.onMatchResult(state, match1, makeResult('1', '2'), [], allMatches);

        const p1 = result.state.players.find((p) => p.id === '1');
        const p2 = result.state.players.find((p) => p.id === '2');

        expect(p1.opponents).toContain('2');
        expect(p2.opponents).toContain('1');
      });
    });

    describe('tournament completion', () => {
      it('marks completed after final round', () => {
        // 4 players → 2 rounds
        const participants = Array.from({ length: 4 }, (_, i) =>
          makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
        );
        const { state: initState, matches: initMatches } = format.generateInitialState({}, participants);

        // Submit Round 1 results (2 matches)
        let currentState = initState;
        const allMatchObjs = initMatches.map((m, i) => ({ ...m, _id: `m${i + 1}` }));

        for (let i = 0; i < 2; i++) {
          const m = allMatchObjs[i];
          const matchDoc = makeMatch({ ...m, status: 'ready' });
          const effectiveAll = allMatchObjs.map((am, j) =>
            makeMatch({ ...am, status: j < i ? 'completed' : 'ready' })
          );
          const result = format.onMatchResult(
            currentState,
            matchDoc,
            makeResult(m.participant_a.participant_id, m.participant_b.participant_id),
            [],
            effectiveAll
          );
          currentState = result.state;
        }

        // Now Round 2 should have been generated (currentRound = 2)
        expect(currentState.currentRound).toBe(2);

        // Submit Round 2 results (2 new matches)
        // We need to create fake Round 2 matches to test completion
        const round2Matches = Array.from({ length: 2 }, (_, i) => ({
          _id: `r2m${i + 1}`,
          round: 2,
          status: 'ready',
          match_number: `R2M${i + 1}`,
          participant_a: { type: 'participant', participant_id: String(i * 2 + 1), name: `P${i * 2 + 1}` },
          participant_b: { type: 'participant', participant_id: String(i * 2 + 2), name: `P${i * 2 + 2}` },
        }));

        for (let i = 0; i < 2; i++) {
          const m = round2Matches[i];
          const matchDoc = makeMatch({ ...m });
          const effectiveAll = round2Matches.map((am, j) =>
            makeMatch({ ...am, status: j < i ? 'completed' : 'ready' })
          );
          const result = format.onMatchResult(
            currentState,
            matchDoc,
            makeResult(m.participant_a.participant_id, m.participant_b.participant_id),
            [],
            effectiveAll
          );
          currentState = result.state;
          if (i === 1) {
            expect(result.tournamentComplete).toBe(true);
            expect(result.state.completed).toBe(true);
          }
        }
      });
    });
  });

  // ─── Rematch avoidance ────────────────────────────────────────────────────

  describe('rematch avoidance', () => {
    it('avoids pairing players who already played each other', () => {
      // 4 players: after round 1 (1v2, 3v4), round 2 should not re-pair them
      const participants = Array.from({ length: 4 }, (_, i) =>
        makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
      );
      const { state: initState, matches: initMatches } = format.generateInitialState({}, participants);

      // Player 1 beats Player 2, Player 3 beats Player 4
      let currentState = initState;
      const allMatchObjs = initMatches.map((m, i) => ({ ...m, _id: `m${i + 1}` }));

      for (let i = 0; i < 2; i++) {
        const m = allMatchObjs[i];
        const matchDoc = makeMatch({ ...m, status: 'ready' });
        const effectiveAll = allMatchObjs.map((am, j) =>
          makeMatch({ ...am, status: j < i ? 'completed' : 'ready' })
        );
        const result = format.onMatchResult(
          currentState,
          matchDoc,
          makeResult(m.participant_a.participant_id, m.participant_b.participant_id),
          [],
          effectiveAll
        );
        currentState = result.state;
      }

      // Round 2 should pair: Player 1 vs Player 3 (both 1W), Player 2 vs Player 4 (both 0W)
      // NOT re-pair 1v2 or 3v4
      const r2State = currentState;
      const pairs = format._generatePairings(r2State.players);
      const realPairs = pairs.filter((p) => !p.bye);

      realPairs.forEach(({ playerAId, playerBId }) => {
        const playerA = r2State.players.find((p) => p.id === playerAId);
        expect(playerA.opponents).not.toContain(playerBId);
      });
    });
  });

  // ─── Bye assignment ───────────────────────────────────────────────────────

  describe('bye assignment', () => {
    it('player who had R1 bye is not first to get R2 bye if others are available', () => {
      // 5 players — one gets a bye in R1
      const participants = Array.from({ length: 5 }, (_, i) =>
        makeParticipant(String(i + 1), `Player ${i + 1}`, i + 1)
      );
      const { state: initState, matches: initMatches } = format.generateInitialState({}, participants);

      // Find who got the R1 bye
      const r1ByePlayer = initState.players.find((p) => p.byes === 1);
      expect(r1ByePlayer).toBeDefined();

      // Simulate all R1 results
      let currentState = initState;
      const realMatches = initMatches.filter((m) => m.status !== 'completed');
      const allMatchObjs = initMatches.map((m, i) => ({ ...m, _id: `m${i + 1}` }));

      for (let i = 0; i < realMatches.length; i++) {
        const m = realMatches[i];
        const matchDoc = makeMatch({ ...m, status: 'ready', _id: `m_real_${i}` });
        const effectiveAll = allMatchObjs.map((am) =>
          makeMatch({
            ...am,
            status: am.status === 'completed' || am._id === matchDoc._id
              ? 'completed'
              : 'ready',
          })
        );
        const result = format.onMatchResult(
          currentState,
          matchDoc,
          makeResult(m.participant_a.participant_id, m.participant_b.participant_id),
          [],
          effectiveAll
        );
        currentState = result.state;
      }

      // In Round 2, the R1 bye player should not get the bye again if others haven't had one
      const r2Pairs = format._generatePairings(currentState.players);
      const r2ByePairs = r2Pairs.filter((p) => p.bye);

      if (r2ByePairs.length > 0) {
        const r2ByePlayer = currentState.players.find(
          (p) => p.id === r2ByePairs[0].playerId
        );
        // The R2 bye player should NOT be the same as R1 bye player
        // unless everyone else has also had a bye
        const playersWithoutBye = currentState.players.filter((p) => p.byes === 0);
        if (playersWithoutBye.length > 0) {
          expect(r2ByePlayer.id).not.toBe(r1ByePlayer.id);
        }
      }
    });
  });

  // ─── Standings ────────────────────────────────────────────────────────────

  describe('standings sorting', () => {
    it('sorts by wins DESC, then gamePointDiff DESC, then seed ASC', () => {
      const players = [
        { id: 'a', name: 'A', seed: 1, wins: 1, losses: 0, byes: 0, gamePointsFor: 45, gamePointsAgainst: 33, opponents: [] },
        { id: 'b', name: 'B', seed: 2, wins: 2, losses: 0, byes: 0, gamePointsFor: 30, gamePointsAgainst: 20, opponents: [] },
        { id: 'c', name: 'C', seed: 3, wins: 1, losses: 0, byes: 0, gamePointsFor: 40, gamePointsAgainst: 25, opponents: [] },
        { id: 'd', name: 'D', seed: 4, wins: 0, losses: 2, byes: 0, gamePointsFor: 10, gamePointsAgainst: 30, opponents: [] },
      ];

      const state = { players, completed: false, totalRounds: 2, currentRound: 2 };
      const standings = format.getStandings(state);
      const data = standings[0].data;

      expect(data[0].name).toBe('B'); // 2 wins
      expect(data[1].name).toBe('C'); // 1 win, +15 diff
      expect(data[2].name).toBe('A'); // 1 win, +12 diff
      expect(data[3].name).toBe('D'); // 0 wins
    });
  });

  // ─── isComplete ───────────────────────────────────────────────────────────

  describe('isComplete', () => {
    it('returns false when not completed', () => {
      expect(format.isComplete({ completed: false })).toBe(false);
    });
    it('returns true when completed', () => {
      expect(format.isComplete({ completed: true })).toBe(true);
    });
  });
});
