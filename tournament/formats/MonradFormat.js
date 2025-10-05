const ITournamentFormat = require('../ITournamentFormat');
const mongoose = require('mongoose');

/**
 * Monrad (Progressive Consolation) Tournament Format
 *
 * Features:
 * - Predetermined bracket structure with fixed seed positions per round
 * - Progressive population: winners/losers fill specific positions
 * - Matches use placeholders until prerequisite matches complete
 * - Produces complete ranking (1st, 2nd, 3rd, ... Nth)
 */
class MonradFormat extends ITournamentFormat {
  get id() {
    return 'monrad';
  }

  get name() {
    return 'Monrad / Progressive Consolation';
  }

  validateConfig(config, participants) {
    const errors = [];

    if (!participants || participants.length < 4) {
      errors.push('At least 4 participants required for Monrad');
    }

    if (participants.length > 32) {
      errors.push('Maximum 32 participants recommended for Monrad');
    }

    // Allow odd numbers - we'll add a bye player automatically
    // No longer require even numbers

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  generateInitialState(config, participants) {
    const sortedParticipants = this._sortParticipants(participants);

    // Handle non-standard tournament sizes by adding bye players
    const adjustedParticipants =
      this._adjustParticipantsForMonrad(sortedParticipants);
    const effectiveParticipantCount = adjustedParticipants.length;
    const totalRounds = this._calculateRounds(effectiveParticipantCount);

    console.log(
      `MonradFormat: Generating initial state for ${sortedParticipants.length} participants (adjusted to ${effectiveParticipantCount}), ${totalRounds} rounds`
    );

    // Generate ALL matches for ALL rounds with placeholders
    const matches = this._generateAllMatches(adjustedParticipants, totalRounds);

    const state = {
      format: 'monrad',
      participantCount: participants.length, // Original count
      effectiveParticipantCount, // Adjusted count with byes
      totalRounds,
      currentRound: 1,
      participantHistory: this._initializeHistory(adjustedParticipants),
      seedPositions: this._initializeSeedPositions(adjustedParticipants),
      completed: false,
    };

    console.log(
      `MonradFormat: Generated ${matches.length} total matches across ${totalRounds} rounds`
    );
    return { state, matches, groups: [] };
  }

  onMatchResult(state, tournamentMatch, matchResult) {
    console.log(
      `MonradFormat: Processing match result for Round ${tournamentMatch.round}, Match ${tournamentMatch.match_number}`
    );
    console.log(
      `MonradFormat: Winner: ${matchResult.winner_name}, Loser: ${matchResult.loser_name}`
    );
    console.log(`MonradFormat: tournamentMatch._id: ${tournamentMatch._id}`);
    console.log(
      `MonradFormat: tournamentMatch keys:`,
      Object.keys(tournamentMatch)
    );

    const updatedMatches = [];
    const newMatches = [];

    // Update current match with result
    // Update current match with result
    // Convert Mongoose document to plain object to preserve _id
    const matchData = tournamentMatch.toObject
      ? tournamentMatch.toObject()
      : tournamentMatch;

    const updatedMatch = {
      ...matchData,
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

    console.log(`MonradFormat: updatedMatch._id: ${updatedMatch._id}`);
    console.log(`MonradFormat: updatedMatch keys:`, Object.keys(updatedMatch));

    updatedMatches.push(updatedMatch);

    // Update participant history and seed positions
    const newState = this._updateParticipantHistory(state, matchResult);
    this._updateSeedPositions(newState, tournamentMatch, matchResult);

    // Find and update any matches that now have both participants determined
    const resolvedMatches = this._resolveWaitingMatches(
      newState,
      tournamentMatch
    );
    updatedMatches.push(...resolvedMatches);

    // Check if tournament is complete
    if (tournamentMatch.round === newState.totalRounds) {
      newState.completed = this._checkTournamentComplete(newState);
    }

    console.log(
      `MonradFormat: Updated ${resolvedMatches.length} waiting matches`
    );

    return {
      state: newState,
      updatedMatches,
      newMatches: [], // We don't create new matches, just resolve existing ones
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    const standings = this._calculateCurrentStandings(state);
    return [
      {
        type: 'progressive',
        title: 'Current Standings',
        data: standings,
      },
    ];
  }

  getNextPlayableMatches(state, matches) {
    // Return matches that have both participants determined and are ready to play
    return matches.filter(
      (match) =>
        match.status === 'ready' &&
        match.participant_a?.type === 'participant' &&
        match.participant_b?.type === 'participant'
    );
  }

  isComplete(state) {
    return state.completed;
  }

  getFinalResults(state) {
    if (!state.completed) return null;
    return this._calculateFinalStandings(state);
  }

  serialize(state) {
    return JSON.stringify(state);
  }

  deserialize(blob) {
    return JSON.parse(blob);
  }

  // Private helper methods

  _adjustParticipantsForMonrad(participants) {
    const supportedSizes = [8, 16, 32];
    const actualCount = participants.length;

    // Find the smallest supported size that can accommodate all participants
    let targetSize = supportedSizes.find((size) => size >= actualCount);

    // If no supported size can accommodate (>32), truncate to 32 and warn
    if (!targetSize) {
      targetSize = 32;
      console.warn(
        `MonradFormat: ${actualCount} participants exceeds maximum. Using first 32 participants.`
      );
      return participants.slice(0, 32); // Take only first 32 participants
    }

    // If we already have the exact supported size, return as-is
    if (actualCount === targetSize) {
      return participants;
    }

    // Add bye players to reach target size
    const adjustedParticipants = [...participants];
    const byeCount = targetSize - actualCount;

    console.log(
      `MonradFormat: Adding ${byeCount} bye players to reach ${targetSize} participants`
    );

    for (let i = 1; i <= byeCount; i++) {
      adjustedParticipants.push({
        _id: new mongoose.Types.ObjectId(), // Generate proper ObjectId for bye players
        name: `BYE ${i}`,
        type: 'bye',
        seed: 999 + i, // Put byes at the end
      });
    }

    return adjustedParticipants;
  }

  _generateAllMatches(participants, totalRounds) {
    const matches = [];
    const participantCount = participants.length;

    // Generate matches for all rounds
    for (let round = 1; round <= totalRounds; round++) {
      const roundMatches = this._generateRoundMatches(
        participants,
        round,
        participantCount
      );
      matches.push(...roundMatches);
    }

    return matches;
  }

  _generateRoundMatches(participants, round, participantCount) {
    const matches = [];
    const matchPairs = this._getMonradPairs(participantCount, round);

    matchPairs.forEach((pair, index) => {
      const matchNumber = index + 1;
      const match = {
        round,
        stage: 'main',
        match_number: `R${round}M${matchNumber}`,
        status: round === 1 ? 'ready' : 'pending', // Only Round 1 matches are initially ready
        dependency_matches: [],
        feeds_to_matches: [],
      };

      if (round === 1) {
        // Round 1: Use actual participants based on seeding
        const participantA = participants[pair[0] - 1]; // Convert 1-based to 0-based
        const participantB = participants[pair[1] - 1];

        // Handle bye matches
        const isByeMatch =
          participantA.type === 'bye' || participantB.type === 'bye';

        match.participant_a = {
          type: participantA.type === 'bye' ? 'bye' : 'participant',
          participant_id: participantA._id,
          name: participantA.name,
        };
        match.participant_b = {
          type: participantB.type === 'bye' ? 'bye' : 'participant',
          participant_id: participantB._id,
          name: participantB.name,
        };

        // Bye matches are automatically completed
        if (isByeMatch) {
          match.status = 'completed';
          const winner =
            participantA.type !== 'bye' ? participantA : participantB;
          const loser =
            participantA.type === 'bye' ? participantA : participantB;
          match.result = {
            winner_participant_id: winner._id,
            winner_name: winner.name,
            loser_participant_id: loser.type === 'bye' ? null : loser._id,
            loser_name: loser.type === 'bye' ? 'BYE' : loser.name,
            game_scores: [],
            walkover: true,
            walkover_reason: 'Bye - automatic advancement',
          };
        }
      } else {
        // Later rounds: Use placeholders that reference seed positions
        match.participant_a = {
          type: 'seed_position',
          seed: pair[0],
          name: `Seed ${pair[0]}`,
        };
        match.participant_b = {
          type: 'seed_position',
          seed: pair[1],
          name: `Seed ${pair[1]}`,
        };
      }

      matches.push(match);
    });

    return matches;
  }

  _getMonradPairs(participantCount, round) {
    // Define the Monrad pairing structure for different participant counts and rounds
    const pairingStructures = {
      8: {
        1: [
          [1, 8],
          [2, 7],
          [3, 6],
          [4, 5],
        ],
        2: [
          [1, 4],
          [2, 3],
          [5, 8],
          [6, 7],
        ],
        3: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      },
      16: {
        1: [
          [1, 16],
          [2, 15],
          [3, 14],
          [4, 13],
          [5, 12],
          [6, 11],
          [7, 10],
          [8, 9],
        ],
        2: [
          [1, 8],
          [2, 7],
          [3, 6],
          [4, 5],
          [9, 16],
          [10, 15],
          [11, 14],
          [12, 13],
        ],
        3: [
          [1, 4],
          [2, 3],
          [5, 8],
          [6, 7],
          [9, 12],
          [10, 11],
          [13, 16],
          [14, 15],
        ],
        4: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
          [9, 10],
          [11, 12],
          [13, 14],
          [15, 16],
        ],
      },
      32: {
        1: [
          [1, 32],
          [2, 31],
          [3, 30],
          [4, 29],
          [5, 28],
          [6, 27],
          [7, 26],
          [8, 25],
          [9, 24],
          [10, 23],
          [11, 22],
          [12, 21],
          [13, 20],
          [14, 19],
          [15, 18],
          [16, 17],
        ],
        2: [
          [1, 16],
          [2, 15],
          [3, 14],
          [4, 13],
          [5, 12],
          [6, 11],
          [7, 10],
          [8, 9],
          [17, 32],
          [18, 31],
          [19, 30],
          [20, 29],
          [21, 28],
          [22, 27],
          [23, 26],
          [24, 25],
        ],
        3: [
          [1, 8],
          [2, 7],
          [3, 6],
          [4, 5],
          [9, 16],
          [10, 15],
          [11, 14],
          [12, 13],
          [17, 24],
          [18, 23],
          [19, 22],
          [20, 21],
          [25, 32],
          [26, 31],
          [27, 30],
          [28, 29],
        ],
        4: [
          [1, 4],
          [2, 3],
          [5, 8],
          [6, 7],
          [9, 12],
          [10, 11],
          [13, 16],
          [14, 15],
          [17, 20],
          [18, 19],
          [21, 24],
          [22, 23],
          [25, 28],
          [26, 27],
          [29, 32],
          [30, 31],
        ],
        5: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
          [9, 10],
          [11, 12],
          [13, 14],
          [15, 16],
          [17, 18],
          [19, 20],
          [21, 22],
          [23, 24],
          [25, 26],
          [27, 28],
          [29, 30],
          [31, 32],
        ],
      },
      // Add more structures as needed
    };

    const structure = pairingStructures[participantCount];
    if (!structure || !structure[round]) {
      throw new Error(
        `Monrad pairing structure not defined for ${participantCount} participants, round ${round}`
      );
    }

    return structure[round];
  }

  _initializeSeedPositions(participants) {
    const seedPositions = {};
    participants.forEach((participant, index) => {
      seedPositions[index + 1] = {
        participant_id: participant._id,
        name: participant.name,
        current_seed: index + 1,
      };
    });
    return seedPositions;
  }

  _updateSeedPositions(state, completedMatch, matchResult) {
    // Determine which seed positions the winner and loser should occupy
    const matchPairs = this._getMonradPairs(
      state.effectiveParticipantCount || state.participantCount,
      completedMatch.round
    );
    const matchIndex =
      parseInt(
        completedMatch.match_number.replace(`R${completedMatch.round}M`, '')
      ) - 1;
    const pair = matchPairs[matchIndex];

    // Winner takes the lower seed, loser takes the higher seed
    const lowerSeed = Math.min(pair[0], pair[1]);
    const higherSeed = Math.max(pair[0], pair[1]);

    // Update seed positions
    state.seedPositions[lowerSeed] = {
      participant_id: matchResult.winner_id,
      name: matchResult.winner_name,
      current_seed: lowerSeed,
    };

    // Only update loser position if it's not a bye
    if (matchResult.loser_id && matchResult.loser_name !== 'BYE') {
      state.seedPositions[higherSeed] = {
        participant_id: matchResult.loser_id,
        name: matchResult.loser_name,
        current_seed: higherSeed,
      };
    }

    console.log(
      `MonradFormat: Updated seed positions - Winner (${matchResult.winner_name}) -> Seed ${lowerSeed}, Loser (${matchResult.loser_name}) -> Seed ${higherSeed}`
    );
  }

  _resolveWaitingMatches(state, completedMatch) {
    const updatedMatches = [];
    const nextRound = completedMatch.round + 1;

    if (nextRound > state.totalRounds) {
      return updatedMatches; // No more rounds
    }

    console.log(
      `MonradFormat: Looking for matches to resolve in round ${nextRound}`
    );

    // Return empty array - the server will handle the actual placeholder resolution
    // We've moved the placeholder resolution logic to the server.js file
    return updatedMatches;
  }

  _sortParticipants(participants) {
    return participants.sort((a, b) => (a.seed || 999) - (b.seed || 999));
  }

  _calculateRounds(participantCount) {
    // Monrad typically has log2(n) rounds
    return Math.ceil(Math.log2(participantCount));
  }

  _initializeHistory(participants) {
    const history = {};
    participants.forEach((participant) => {
      history[participant._id] = {
        participant_id: participant._id,
        name: participant.name,
        wins: 0,
        losses: 0,
        opponents: [],
        current_seed: participant.seed || 999,
      };
    });
    return history;
  }

  _updateParticipantHistory(state, matchResult) {
    const newState = { ...state };
    const history = { ...newState.participantHistory };

    // Update winner
    if (history[matchResult.winner_id]) {
      history[matchResult.winner_id] = {
        ...history[matchResult.winner_id],
        wins: history[matchResult.winner_id].wins + 1,
        opponents: [
          ...history[matchResult.winner_id].opponents,
          matchResult.loser_id,
        ],
      };
    }

    // Update loser
    if (history[matchResult.loser_id]) {
      history[matchResult.loser_id] = {
        ...history[matchResult.loser_id],
        losses: history[matchResult.loser_id].losses + 1,
        opponents: [
          ...history[matchResult.loser_id].opponents,
          matchResult.winner_id,
        ],
      };
    }

    newState.participantHistory = history;
    return newState;
  }

  _calculateCurrentStandings(state) {
    const participants = Object.values(state.participantHistory);

    // Sort by current seed position (lower is better)
    const standings = participants.sort((a, b) => {
      const seedA = this._getCurrentSeed(state, a.participant_id);
      const seedB = this._getCurrentSeed(state, b.participant_id);
      return seedA - seedB;
    });

    return standings.map((participant, index) => ({
      position: index + 1,
      participant_id: participant.participant_id,
      name: participant.name,
      wins: participant.wins,
      losses: participant.losses,
      current_seed: this._getCurrentSeed(state, participant.participant_id),
    }));
  }

  _getCurrentSeed(state, participantId) {
    // Find current seed position for this participant
    for (const [seed, info] of Object.entries(state.seedPositions)) {
      if (info.participant_id === participantId) {
        return parseInt(seed);
      }
    }
    return 999; // Fallback
  }

  _calculateFinalStandings(state) {
    return this._calculateCurrentStandings(state);
  }

  _checkTournamentComplete(state) {
    // Tournament is complete when all matches in the final round are done
    // This would need to be checked against actual match data
    return false; // Placeholder
  }
}

module.exports = MonradFormat;
