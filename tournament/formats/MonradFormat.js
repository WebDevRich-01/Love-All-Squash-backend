const ITournamentFormat = require('../ITournamentFormat');

/**
 * Monrad (Progressive Consolation) Tournament Format
 *
 * Features:
 * - Everyone plays every round
 * - Winners move up, losers move down
 * - Produces complete ranking (1st, 2nd, 3rd, ... Nth)
 * - No rematches in adjacent rounds where possible
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

    // Must be even number for pairing
    if (participants.length % 2 !== 0) {
      errors.push('Even number of participants required for Monrad');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  generateInitialState(config, participants) {
    const totalRounds = this._calculateRounds(participants.length);
    const sortedParticipants = this._sortParticipants(participants);

    // Generate first round matches using initial seeding
    const matches = this._generateFirstRoundMatches(sortedParticipants);

    const state = {
      format: 'monrad',
      participantCount: participants.length,
      totalRounds,
      currentRound: 1,
      participantHistory: this._initializeHistory(sortedParticipants),
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

    // Update participant history
    const newState = this._updateParticipantHistory(state, matchResult);

    // For Monrad, we generate matches progressively
    // Check if we should generate matches for the next round
    if (tournamentMatch.round < newState.totalRounds) {
      // Generate matches for the next round
      const nextRoundMatches = this._generateNextRoundMatches(
        newState,
        tournamentMatch.round + 1
      );
      console.log(
        `MonradFormat: Generated ${nextRoundMatches.length} matches for round ${
          tournamentMatch.round + 1
        }`
      );
      newMatches.push(...nextRoundMatches);
    } else {
      newState.completed = true;
    }

    return {
      state: newState,
      updatedMatches,
      newMatches,
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    const standings = this._calculateCurrentStandings(state);

    return {
      type: 'progressive',
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      standings: standings.map((participant, index) => ({
        position: index + 1,
        participant_id: participant.participant_id,
        name: participant.name,
        wins: participant.wins,
        losses: participant.losses,
        current_level: participant.current_level,
        trajectory: participant.trajectory, // 'up', 'down', 'stable'
      })),
    };
  }

  getNextPlayableMatches(state, matches) {
    // For Monrad, we return existing matches that are ready to play
    // New matches are generated in onMatchResult and saved to the database

    const existingMatches = matches || [];

    // Return matches that are ready to play
    return existingMatches.filter((match) => match.status === 'ready');
  }

  isComplete(state) {
    return state.completed;
  }

  getFinalResults(state, groups = []) {
    return this._calculateFinalPlacements(state);
  }

  // Private helper methods

  _calculateRounds(participantCount) {
    // Typically 3-5 rounds depending on field size
    if (participantCount <= 8) return 3;
    if (participantCount <= 16) return 4;
    return 5;
  }

  _sortParticipants(participants) {
    return participants.sort((a, b) => {
      if (a.seed && b.seed) return a.seed - b.seed;
      if (a.seed && !b.seed) return -1;
      if (!a.seed && b.seed) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  _generateFirstRoundMatches(participants) {
    const matches = [];
    let matchNumber = 1;

    // Pair 1 vs N, 2 vs N-1, etc.
    for (let i = 0; i < participants.length / 2; i++) {
      const participantA = participants[i];
      const participantB = participants[participants.length - 1 - i];

      const match = {
        round: 1,
        stage: 'main',
        match_number: `R1M${matchNumber}`,
        participant_a: {
          type: 'participant',
          participant_id: participantA._id,
          name: participantA.name,
        },
        participant_b: {
          type: 'participant',
          participant_id: participantB._id,
          name: participantB.name,
        },
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      };

      matches.push(match);
      matchNumber++;
    }

    return matches;
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
        current_level: 1,
        trajectory: 'stable',
      };
    });
    return history;
  }

  _updateParticipantHistory(state, matchResult) {
    const newState = { ...state };
    const history = { ...newState.participantHistory };

    // Update winner
    const winner = history[matchResult.winner_id];
    winner.wins += 1;
    winner.opponents.push(matchResult.loser_id);
    winner.trajectory = 'up';

    // Update loser
    const loser = history[matchResult.loser_id];
    loser.losses += 1;
    loser.opponents.push(matchResult.winner_id);
    loser.trajectory = 'down';

    newState.participantHistory = history;
    return newState;
  }

  _isRoundComplete(state, round) {
    // Check if all matches in the current round are completed
    // This should check against actual match data, not just return true
    // For now, we'll implement a simple check
    return true; // TODO: Implement proper round completion check
  }

  _generateNextRoundMatches(state, round) {
    // For Monrad, we generate matches progressively
    // Only create matches for players who are ready to play

    const participants = Object.values(state.participantHistory);
    const sortedByRecord = this._sortByMonradRecord(participants);

    const matches = [];
    let matchNumber = 1;
    const paired = new Set();

    // For the first round, pair all players
    if (round === 1) {
      for (let i = 0; i < sortedByRecord.length; i += 2) {
        if (i + 1 < sortedByRecord.length) {
          const match = {
            round,
            stage: 'main',
            match_number: `R${round}M${matchNumber}`,
            participant_a: {
              type: 'participant',
              participant_id: sortedByRecord[i].participant_id,
              name: sortedByRecord[i].name,
            },
            participant_b: {
              type: 'participant',
              participant_id: sortedByRecord[i + 1].participant_id,
              name: sortedByRecord[i + 1].name,
            },
            status: 'ready',
            dependency_matches: [],
            feeds_to_matches: [],
          };
          matches.push(match);
          matchNumber++;
        }
      }
    } else {
      // For subsequent rounds, we need to be more careful
      // Only generate matches for players who have completed their previous round
      // For now, let's generate matches for all players but mark them as 'pending'
      // until their previous round matches are complete

      // Create placeholder matches that will be populated as players become available
      for (let i = 0; i < sortedByRecord.length; i += 2) {
        if (i + 1 < sortedByRecord.length) {
          const match = {
            round,
            stage: 'main',
            match_number: `R${round}M${matchNumber}`,
            participant_a: {
              type: 'participant',
              participant_id: sortedByRecord[i].participant_id,
              name: sortedByRecord[i].name,
            },
            participant_b: {
              type: 'participant',
              participant_id: sortedByRecord[i + 1].participant_id,
              name: sortedByRecord[i + 1].name,
            },
            status: 'ready',
            dependency_matches: [],
            feeds_to_matches: [],
          };
          matches.push(match);
          matchNumber++;
        }
      }
    }

    return matches;
  }

  _sortByMonradRecord(participants) {
    return participants.sort((a, b) => {
      // Sort by wins first, then by strength of opposition
      if (a.wins !== b.wins) return b.wins - a.wins;
      return 0; // Additional tiebreakers would go here
    });
  }

  _calculateCurrentStandings(state) {
    const participants = Object.values(state.participantHistory);
    return this._sortByMonradRecord(participants);
  }

  _sortParticipants(participants) {
    // Sort participants by seed (1, 2, 3, ...)
    return participants.sort((a, b) => (a.seed || 0) - (b.seed || 0));
  }

  _calculateRounds(participantCount) {
    // Monrad typically runs for log2(n) rounds, minimum 3 rounds
    return Math.max(3, Math.ceil(Math.log2(participantCount)));
  }

  _calculateFinalPlacements(state) {
    const standings = this._calculateCurrentStandings(state);
    return standings.map((participant, index) => ({
      position: index + 1,
      participant_id: participant.participant_id,
      name: participant.name,
      wins: participant.wins,
      losses: participant.losses,
      final_level: participant.current_level,
    }));
  }
}

module.exports = MonradFormat;
