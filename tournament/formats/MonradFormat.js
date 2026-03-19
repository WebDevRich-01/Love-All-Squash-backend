const ITournamentFormat = require('../ITournamentFormat');

/**
 * Monrad (Swiss) Tournament Format
 *
 * True Swiss pairing — rounds are generated dynamically after each round completes.
 * Matches players with similar win records; avoids rematches where possible.
 *
 * State blob structure:
 * {
 *   format: 'monrad',
 *   totalRounds: number,
 *   currentRound: number,
 *   completed: boolean,
 *   players: [{
 *     id: string,          // participant ObjectId as string
 *     name: string,
 *     seed: number,
 *     wins: number,
 *     losses: number,
 *     byes: number,
 *     gamePointsFor: number,
 *     gamePointsAgainst: number,
 *     opponents: string[], // participant IDs of past opponents
 *   }]
 * }
 */
class MonradFormat extends ITournamentFormat {
  get id() {
    return 'monrad';
  }

  get name() {
    return 'Monrad (Swiss)';
  }

  validateConfig(config, participants) {
    const errors = [];
    if (!participants || participants.length < 4) {
      errors.push('At least 4 participants required for Monrad');
    }
    if (participants.length > 32) {
      errors.push('Maximum 32 participants for Monrad');
    }
    return { valid: errors.length === 0, errors };
  }

  generateInitialState(config, participants) {
    const isHandicap = !!(config && config.match && config.match.is_handicap);

    // Sort by seed ascending; unseeded participants go to end
    // For handicap tournaments the seed reflects the user's chosen order (randomised/alphabetised)
    const sorted = [...participants].sort(
      (a, b) => (a.seed || 999) - (b.seed || 999)
    );

    const totalPlayers = sorted.length;
    const totalRounds = Math.ceil(Math.log2(totalPlayers));

    // Build players array from participant documents
    let players = sorted.map((p, i) => ({
      id: p._id.toString(),
      name: p.name,
      seed: p.seed || i + 1,
      wins: 0,
      losses: 0,
      byes: 0,
      gamePointsFor: 0,
      gamePointsAgainst: 0,
      opponents: [],
    }));

    // Round 1: top-vs-bottom pairing (same for both modes — seeds reflect chosen order)
    const pairs = this._generateSeededRound1Pairings(players);

    // Apply bye wins to players before creating state
    players = this._applyByesToPlayers(players, pairs);

    const state = {
      format: 'monrad',
      totalRounds,
      totalPlayers,
      isHandicap,
      currentRound: 1,
      completed: false,
      players,
    };

    const matches = this._pairsToMatches(pairs, players, 1);
    return { state, matches, groups: [] };
  }

  onMatchResult(state, tournamentMatch, matchResult, groups = [], allMatches = []) {
    // Mark current match as completed
    const matchData = tournamentMatch.toObject
      ? tournamentMatch.toObject()
      : { ...tournamentMatch };

    const updatedMatch = {
      ...matchData,
      status: 'completed',
      completed_at: new Date(),
      result: {
        winner_participant_id: matchResult.winner_id,
        winner_name: matchResult.winner_name,
        loser_participant_id: matchResult.loser_id,
        loser_name: matchResult.loser_name,
        game_scores: matchResult.game_scores || [],
        walkover: matchResult.walkover || false,
        retired: matchResult.retired || false,
      },
    };

    const updatedMatches = [updatedMatch];
    let newMatches = [];

    // Update player win/loss/game-point stats
    let newState = this._updatePlayerStats(state, tournamentMatch, matchResult);

    // Build effective matches list for round-completion check
    const currentMatchId = tournamentMatch._id?.toString();
    const effectiveMatches = allMatches.map((m) => {
      if (m._id?.toString() === currentMatchId) return updatedMatch;
      return m;
    });

    // Check if the current round is now complete
    const roundMatches = effectiveMatches.filter(
      (m) => m.round === newState.currentRound
    );
    const roundComplete =
      roundMatches.length > 0 &&
      roundMatches.every(
        (m) => m.status === 'completed' || m.status === 'walkover'
      );

    if (roundComplete) {
      if (newState.currentRound < newState.totalRounds) {
        // Generate next round's pairings
        const nextRound = newState.currentRound + 1;
        const pairs = newState.isHandicap
          ? this._generateHandicapPairings(newState.players, nextRound, newState.totalPlayers)
          : this._generatePairings(newState.players);

        // Update bye counts and give bye players their automatic win
        newState = {
          ...newState,
          currentRound: newState.currentRound + 1,
          players: this._applyByesToPlayers(newState.players, pairs),
        };

        newMatches = this._pairsToMatches(pairs, newState.players, newState.currentRound);
      } else {
        newState = { ...newState, completed: true };
      }
    }

    return {
      state: newState,
      updatedMatches,
      newMatches,
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    return [
      {
        type: 'progressive',
        title: 'Standings',
        data: this._sortedStandings(state.players),
      },
    ];
  }

  getNextPlayableMatches(state, matches) {
    return matches.filter((m) => m.status === 'ready');
  }

  isComplete(state) {
    return state.completed === true;
  }

  getFinalResults(state) {
    if (!state.completed) return null;
    return this._sortedStandings(state.players);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Update player win/loss/game-point stats after a real match result.
   * (Bye wins are handled separately in _applyByesToPlayers.)
   */
  _updatePlayerStats(state, tournamentMatch, matchResult) {
    const winnerId = matchResult.winner_id?.toString();
    const loserId = matchResult.loser_id?.toString();

    // Determine which side of the match the winner was on
    const winnerIsA =
      tournamentMatch.participant_a?.participant_id?.toString() === winnerId;

    // Accumulate game points from score array
    let winnerPointsFor = 0;
    let winnerPointsAgainst = 0;
    (matchResult.game_scores || []).forEach((gs) => {
      if (winnerIsA) {
        winnerPointsFor += gs.player1 || 0;
        winnerPointsAgainst += gs.player2 || 0;
      } else {
        winnerPointsFor += gs.player2 || 0;
        winnerPointsAgainst += gs.player1 || 0;
      }
    });

    const newPlayers = state.players.map((p) => {
      const pid = p.id?.toString();
      if (pid === winnerId) {
        return {
          ...p,
          wins: p.wins + 1,
          gamePointsFor: p.gamePointsFor + winnerPointsFor,
          gamePointsAgainst: p.gamePointsAgainst + winnerPointsAgainst,
          opponents: loserId ? [...p.opponents, loserId] : p.opponents,
        };
      }
      if (pid === loserId) {
        return {
          ...p,
          losses: p.losses + 1,
          gamePointsFor: p.gamePointsFor + winnerPointsAgainst,
          gamePointsAgainst: p.gamePointsAgainst + winnerPointsFor,
          opponents: winnerId ? [...p.opponents, winnerId] : p.opponents,
        };
      }
      return p;
    });

    return { ...state, players: newPlayers };
  }

  /**
   * Apply automatic bye wins to players who received a bye this round.
   */
  _applyByesToPlayers(players, pairs) {
    const byePlayerIds = pairs.filter((p) => p.bye).map((p) => p.playerId);
    if (byePlayerIds.length === 0) return players;
    return players.map((p) => {
      if (byePlayerIds.includes(p.id)) {
        return { ...p, wins: p.wins + 1, byes: p.byes + 1 };
      }
      return p;
    });
  }

  /**
   * Round 1 seeded pairing: pair top half against bottom half in reverse.
   * 1vN, 2vN-1, 3vN-2, ...
   * If odd number of players, lowest seed gets a bye first.
   */
  _generateSeededRound1Pairings(players) {
    // Players are already sorted by seed ascending
    const sorted = [...players];
    const pairs = [];

    // Handle odd draw: lowest seed (last) gets a bye
    if (sorted.length % 2 !== 0) {
      const byePlayer = sorted.pop();
      pairs.push({ bye: true, playerId: byePlayer.id });
    }

    // Pair first vs last, second vs second-to-last, etc.
    const half = sorted.length / 2;
    for (let i = 0; i < half; i++) {
      pairs.push({ playerAId: sorted[i].id, playerBId: sorted[sorted.length - 1 - i].id });
    }

    return pairs;
  }

  /**
   * Swiss pairing algorithm.
   *
   * Returns an array of:
   *   { playerAId, playerBId }  — real match
   *   { bye: true, playerId }   — bye
   */
  _generatePairings(players) {
    // Sort: wins DESC → gamePointDiff DESC → seed ASC
    const sorted = [...players].sort((a, b) => {
      const winDiff = b.wins - a.wins;
      if (winDiff !== 0) return winDiff;
      const diffA = a.gamePointsFor - a.gamePointsAgainst;
      const diffB = b.gamePointsFor - b.gamePointsAgainst;
      const gpDiff = diffB - diffA;
      if (gpDiff !== 0) return gpDiff;
      return a.seed - b.seed;
    });

    const pairs = [];
    const unpaired = [...sorted];

    // Handle odd draw: give bye to lowest-ranked player who hasn't had one yet
    if (unpaired.length % 2 !== 0) {
      let byeIndex = -1;
      for (let i = unpaired.length - 1; i >= 0; i--) {
        if (unpaired[i].byes === 0) {
          byeIndex = i;
          break;
        }
      }
      if (byeIndex === -1) byeIndex = unpaired.length - 1; // all have had byes

      const byePlayer = unpaired.splice(byeIndex, 1)[0];
      pairs.push({ bye: true, playerId: byePlayer.id });
    }

    // Greedy pairing: always take highest-ranked unpaired player,
    // pair with first non-rematch in remaining list
    while (unpaired.length >= 2) {
      const playerA = unpaired.shift();

      let opponentIndex = -1;
      for (let i = 0; i < unpaired.length; i++) {
        if (!playerA.opponents.includes(unpaired[i].id)) {
          opponentIndex = i;
          break;
        }
      }
      // If every remaining player is a rematch, allow it (unavoidable)
      if (opponentIndex === -1) opponentIndex = 0;

      const playerB = unpaired.splice(opponentIndex, 1)[0];
      pairs.push({ playerAId: playerA.id, playerBId: playerB.id });
    }

    return pairs;
  }

  /**
   * Handicap pairing algorithm.
   *
   * Re-ranks all players by wins DESC → points diff DESC, then splits into
   * groups whose size halves each round. Within each group the top half plays
   * the bottom half. Rematches are avoided by swapping within the bottom half.
   *
   *   Round 1 (handled by _generateSeededRound1Pairings):  1vN/2+1, 2vN/2+2 …
   *   Round 2: groups of N/2  →  within each group: top-quarter v bottom-quarter
   *   Round 3: groups of N/4  →  pairs of 2 within each group
   *   Round 4: groups of 2    →  direct final pairs
   */
  _generateHandicapPairings(players, roundNumber, totalPlayers) {
    // Re-rank: wins DESC → points diff DESC
    const ranked = [...players].sort((a, b) => {
      const winDiff = b.wins - a.wins;
      if (winDiff !== 0) return winDiff;
      const diffA = a.gamePointsFor - a.gamePointsAgainst;
      const diffB = b.gamePointsFor - b.gamePointsAgainst;
      return diffB - diffA;
    });

    // Group size halves every round starting from N at round 1
    const groupSize = Math.max(2, Math.round(totalPlayers / Math.pow(2, roundNumber - 1)));
    const pairs = [];

    for (let g = 0; g < ranked.length; g += groupSize) {
      const group = [...ranked.slice(g, g + groupSize)];

      // Odd group: give bye to lowest-ranked player who hasn't had one yet
      if (group.length % 2 !== 0) {
        let byeIdx = group.length - 1;
        for (let j = group.length - 1; j >= 0; j--) {
          if (group[j].byes === 0) { byeIdx = j; break; }
        }
        const [byePlayer] = group.splice(byeIdx, 1);
        pairs.push({ bye: true, playerId: byePlayer.id });
      }

      const half = group.length / 2;
      const topHalf = group.slice(0, half);
      const bottomHalf = [...group.slice(half)];

      // Pair each top-half player with a bottom-half player, avoiding rematches
      for (let j = 0; j < half; j++) {
        const playerA = topHalf[j];
        // Find first available non-rematch from position j onwards in bottomHalf
        let bIdx = j;
        for (let k = j; k < bottomHalf.length; k++) {
          if (!playerA.opponents.includes(bottomHalf[k].id)) {
            bIdx = k;
            break;
          }
        }
        // Swap chosen opponent into position j so later iterations stay tidy
        if (bIdx !== j) {
          [bottomHalf[j], bottomHalf[bIdx]] = [bottomHalf[bIdx], bottomHalf[j]];
        }
        pairs.push({ playerAId: playerA.id, playerBId: bottomHalf[j].id });
      }
    }

    return pairs;
  }

  /**
   * Convert pairing objects into TournamentMatch-ready documents.
   */
  _pairsToMatches(pairs, players, round) {
    return pairs.map((pair, i) => {
      const matchNumber = `R${round}M${i + 1}`;

      if (pair.bye) {
        const player = players.find((p) => p.id === pair.playerId);
        return {
          round,
          stage: 'main',
          match_number: matchNumber,
          participant_a: {
            type: 'participant',
            participant_id: pair.playerId,
            name: player?.name || '',
          },
          participant_b: { type: 'bye', name: 'BYE' },
          status: 'completed',
          result: {
            winner_participant_id: pair.playerId,
            winner_name: player?.name || '',
            loser_participant_id: null,
            loser_name: 'BYE',
            game_scores: [],
            walkover: true,
            walkover_reason: 'Bye',
          },
        };
      }

      const playerA = players.find((p) => p.id === pair.playerAId);
      const playerB = players.find((p) => p.id === pair.playerBId);
      return {
        round,
        stage: 'main',
        match_number: matchNumber,
        participant_a: {
          type: 'participant',
          participant_id: pair.playerAId,
          name: playerA?.name || '',
        },
        participant_b: {
          type: 'participant',
          participant_id: pair.playerBId,
          name: playerB?.name || '',
        },
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      };
    });
  }

  /**
   * Return players sorted by standing for display/results.
   */
  _sortedStandings(players) {
    const sorted = [...players].sort((a, b) => {
      const winDiff = b.wins - a.wins;
      if (winDiff !== 0) return winDiff;
      const diffA = a.gamePointsFor - a.gamePointsAgainst;
      const diffB = b.gamePointsFor - b.gamePointsAgainst;
      const gpDiff = diffB - diffA;
      if (gpDiff !== 0) return gpDiff;
      return a.seed - b.seed;
    });

    return sorted.map((p, i) => ({
      rank: i + 1,
      participant_id: p.id,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      byes: p.byes,
      gamePointDiff: p.gamePointsFor - p.gamePointsAgainst,
    }));
  }
}

module.exports = MonradFormat;
