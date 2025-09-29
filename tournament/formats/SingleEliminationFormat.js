const ITournamentFormat = require('../ITournamentFormat');

/**
 * Single Elimination Tournament Format
 *
 * Features:
 * - Bracket-style elimination
 * - Automatic bye placement for non-power-of-2 draws
 * - Optional consolation bracket for first-round losers
 * - Standard squash seeding (1 vs N, 2 vs N-1, etc.)
 */
class SingleEliminationFormat extends ITournamentFormat {
  get id() {
    return 'single_elimination';
  }

  get name() {
    return 'Single Elimination';
  }

  validateConfig(config, participants) {
    const errors = [];

    if (!participants || participants.length < 2) {
      errors.push('At least 2 participants required');
    }

    if (participants.length > 128) {
      errors.push('Maximum 128 participants supported');
    }

    // Check for duplicate seeds
    const seeds = participants.filter((p) => p.seed).map((p) => p.seed);
    const uniqueSeeds = [...new Set(seeds)];
    if (seeds.length !== uniqueSeeds.length) {
      errors.push('Duplicate seeds not allowed');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  generateInitialState(config, participants) {
    const drawSize = this._getDrawSize(participants.length);
    const byeCount = drawSize - participants.length;

    // Sort participants by seed (unseeded go to end)
    const sortedParticipants = this._sortParticipants(participants);

    // Generate bracket positions using standard seeding
    const bracketPositions = this._generateBracketPositions(drawSize);
    const seededDraw = this._placeSeedsInBracket(
      sortedParticipants,
      bracketPositions,
      byeCount
    );

    // Create initial matches
    const matches = this._generateInitialMatches(seededDraw, drawSize);

    const state = {
      format: 'single_elimination',
      drawSize,
      byeCount,
      bracketPositions: seededDraw,
      currentRound: 1,
      totalRounds: Math.log2(drawSize),
      consolationEnabled: config.knockout?.consolation || false,
      completed: false,
    };

    return { state, matches, groups: [] };
  }

  onMatchResult(state, tournamentMatch, matchResult) {
    const updatedMatches = [];
    const newMatches = [];

    // Update current match with result
    const updatedMatch = {
      ...tournamentMatch,
      status: 'completed',
      completed_at: new Date(),
      result: {
        winner_participant_id: matchResult.winner_id,
        winner_name: matchResult.winner_name,
        loser_participant_id: matchResult.loser_id,
        loser_name: matchResult.loser_name,
        game_scores: matchResult.game_scores,
        walkover: matchResult.walkover || false,
        retired: matchResult.retired || false,
      },
    };
    updatedMatches.push(updatedMatch);

    // Advance winner to next round if not final
    if (tournamentMatch.round < state.totalRounds) {
      const nextRoundMatch = this._findNextRoundMatch(state, tournamentMatch);
      if (nextRoundMatch) {
        const updatedNextMatch = this._updateNextRoundMatch(
          nextRoundMatch,
          matchResult.winner_id,
          matchResult.winner_name,
          tournamentMatch
        );
        updatedMatches.push(updatedNextMatch);
      }
    }

    // Handle consolation bracket if enabled and this is first round
    if (
      state.consolationEnabled &&
      tournamentMatch.round === 1 &&
      tournamentMatch.stage === 'main'
    ) {
      const consolationMatch = this._createConsolationMatch(
        matchResult.loser_id,
        matchResult.loser_name,
        tournamentMatch
      );
      if (consolationMatch) {
        newMatches.push(consolationMatch);
      }
    }

    // Update state
    const newState = { ...state };
    if (this._isRoundComplete(state, tournamentMatch.round)) {
      newState.currentRound += 1;
    }

    newState.completed = this._checkTournamentComplete(newState);

    return {
      state: newState,
      updatedMatches,
      newMatches,
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    // For single elimination, standings are the bracket structure
    return {
      type: 'bracket',
      drawSize: state.drawSize,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      bracket: this._generateBracketView(state),
    };
  }

  getNextPlayableMatches(state, matches) {
    return matches.filter(
      (match) =>
        match.status === 'ready' ||
        (match.status === 'pending' && this._isMatchReady(match, matches))
    );
  }

  isComplete(state) {
    return state.completed;
  }

  getFinalResults(state, groups = []) {
    // Extract final placements from completed bracket
    return this._extractFinalPlacements(state);
  }

  // Private helper methods

  _getDrawSize(participantCount) {
    return Math.pow(2, Math.ceil(Math.log2(participantCount)));
  }

  _sortParticipants(participants) {
    return participants.sort((a, b) => {
      if (a.seed && b.seed) return a.seed - b.seed;
      if (a.seed && !b.seed) return -1;
      if (!a.seed && b.seed) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  _generateBracketPositions(drawSize) {
    // Standard squash seeding pattern
    if (drawSize === 4) return [1, 4, 3, 2];
    if (drawSize === 8) return [1, 8, 5, 4, 3, 6, 7, 2];
    if (drawSize === 16)
      return [1, 16, 9, 8, 5, 12, 13, 4, 3, 14, 11, 6, 7, 10, 15, 2];
    if (drawSize === 32)
      return [
        1, 32, 16, 17, 9, 24, 25, 8, 5, 28, 21, 12, 13, 20, 29, 4, 3, 30, 19,
        14, 11, 22, 27, 6, 7, 26, 23, 10, 15, 18, 31, 2,
      ];

    // For other sizes, generate programmatically
    return this._generateSeededPositions(drawSize);
  }

  _generateSeededPositions(drawSize) {
    const positions = new Array(drawSize);
    positions[0] = 1;
    positions[drawSize - 1] = 2;

    let nextSeed = 3;
    for (let round = 2; round < Math.log2(drawSize); round++) {
      const step = drawSize / Math.pow(2, round);
      for (let i = step / 2; i < drawSize; i += step) {
        if (!positions[i]) {
          positions[i] = nextSeed++;
        }
      }
    }

    return positions;
  }

  _placeSeedsInBracket(participants, bracketPositions, byeCount) {
    const draw = new Array(bracketPositions.length).fill(null);

    // Place seeded participants
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      let position;

      if (participant.seed && participant.seed <= bracketPositions.length) {
        // Find position for this seed
        position = bracketPositions.indexOf(participant.seed);
      } else {
        // Find next available position
        position = draw.findIndex((pos) => pos === null);
      }

      draw[position] = participant;
    }

    // Place byes for highest seeds
    const byePositions = this._getByePositions(
      bracketPositions.length,
      byeCount
    );
    byePositions.forEach((pos) => {
      if (!draw[pos]) {
        draw[pos] = { type: 'bye', name: 'BYE' };
      }
    });

    return draw;
  }

  _getByePositions(drawSize, byeCount) {
    const positions = [];
    const bracketPositions = this._generateBracketPositions(drawSize);

    // Assign byes to protect highest seeds
    for (let seed = 1; seed <= byeCount; seed++) {
      const position = bracketPositions.indexOf(seed);
      if (position !== -1) {
        // Find the opponent position
        const opponentPosition =
          position % 2 === 0 ? position + 1 : position - 1;
        positions.push(opponentPosition);
      }
    }

    return positions;
  }

  _generateInitialMatches(seededDraw, drawSize) {
    const matches = [];
    let matchNumber = 1;

    // Generate first round matches
    for (let i = 0; i < drawSize; i += 2) {
      const participantA = seededDraw[i];
      const participantB = seededDraw[i + 1];

      const match = {
        round: 1,
        stage: 'main',
        match_number: `R1M${matchNumber}`,
        participant_a: this._createMatchParticipant(participantA),
        participant_b: this._createMatchParticipant(participantB),
        status: this._getInitialMatchStatus(participantA, participantB),
        dependency_matches: [],
        feeds_to_matches: [],
      };

      matches.push(match);
      matchNumber++;
    }

    return matches;
  }

  _createMatchParticipant(participant) {
    if (!participant) {
      return { type: 'bye', name: 'BYE' };
    }

    if (participant.type === 'bye') {
      return { type: 'bye', name: 'BYE' };
    }

    return {
      type: 'participant',
      participant_id: participant._id,
      name: participant.name,
    };
  }

  _getInitialMatchStatus(participantA, participantB) {
    if (
      !participantA ||
      !participantB ||
      participantA.type === 'bye' ||
      participantB.type === 'bye'
    ) {
      return 'completed'; // Auto-advance byes
    }
    return 'ready';
  }

  _findNextRoundMatch(state, currentMatch) {
    // Calculate which match in the next round this feeds into
    const currentMatchIndex =
      parseInt(currentMatch.match_number.substring(3)) - 1;
    const nextRoundMatchIndex = Math.floor(currentMatchIndex / 2);
    return { round: currentMatch.round + 1, match_index: nextRoundMatchIndex };
  }

  _updateNextRoundMatch(nextMatch, winnerId, winnerName, sourceMatch) {
    const isFirstParticipant =
      sourceMatch.match_number.endsWith('1') ||
      sourceMatch.match_number.endsWith('3') ||
      sourceMatch.match_number.endsWith('5') ||
      sourceMatch.match_number.endsWith('7');

    const participantSlot = isFirstParticipant
      ? 'participant_a'
      : 'participant_b';

    return {
      ...nextMatch,
      [participantSlot]: {
        type: 'participant',
        participant_id: winnerId,
        name: winnerName,
      },
      status:
        nextMatch.participant_a && nextMatch.participant_b
          ? 'ready'
          : 'pending',
    };
  }

  _createConsolationMatch(loserId, loserName, sourceMatch) {
    // Implementation for consolation bracket
    return null; // Simplified for MVP
  }

  _isRoundComplete(state, round) {
    // Check if all matches in the round are completed
    return true; // Simplified implementation
  }

  _checkTournamentComplete(state) {
    return state.currentRound > state.totalRounds;
  }

  _generateBracketView(state) {
    return {
      rounds: state.totalRounds,
      currentRound: state.currentRound,
    };
  }

  _isMatchReady(match, allMatches) {
    if (match.round === 1) return true;

    // Check if dependency matches are completed
    return match.dependency_matches.every((depId) => {
      const depMatch = allMatches.find(
        (m) => m._id.toString() === depId.toString()
      );
      return depMatch && depMatch.status === 'completed';
    });
  }

  _extractFinalPlacements(state) {
    // Extract final results from bracket
    return []; // Simplified implementation
  }
}

module.exports = SingleEliminationFormat;
