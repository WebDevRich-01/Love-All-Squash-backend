const ITournamentFormat = require('../ITournamentFormat');

/**
 * Round Robin Tournament Format
 *
 * Features:
 * - Each player plays every other player once
 * - Comprehensive standings with tiebreakers
 * - Support for multiple groups/pools
 * - Standard squash tiebreaker rules
 */
class RoundRobinFormat extends ITournamentFormat {
  get id() {
    return 'round_robin';
  }

  get name() {
    return 'Round Robin';
  }

  validateConfig(config, participants) {
    const errors = [];

    if (!participants || participants.length < 3) {
      errors.push('At least 3 participants required for round robin');
    }

    if (participants.length > 20) {
      errors.push('Maximum 20 participants recommended for single round robin');
    }

    const targetGroupSize = config.groups?.target_size || participants.length;
    if (targetGroupSize < 3) {
      errors.push('Group size must be at least 3');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  generateInitialState(config, participants) {
    const groupSize = config.groups?.target_size || participants.length;
    const groups = this._createGroups(participants, groupSize);
    const matches = [];

    // Generate round-robin fixtures for each group
    groups.forEach((group, groupIndex) => {
      const groupMatches = this._generateRoundRobinFixtures(group, groupIndex);
      matches.push(...groupMatches);
    });

    const state = {
      format: 'round_robin',
      totalRounds: this._calculateTotalRounds(groupSize),
      currentRound: 1,
      groupCount: groups.length,
      tiebreakers: config.tiebreakers || [
        'wins',
        'h2h',
        'game_diff',
        'point_diff',
        'fewest_walkovers',
        'random',
      ],
      completed: false,
    };

    return { state, matches, groups };
  }

  onMatchResult(state, tournamentMatch, matchResult) {
    const updatedMatches = [];
    const standingsUpdates = [];

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

    // Calculate updated standings for the group
    const groupStandings = this._calculateGroupStandings(
      tournamentMatch.group_id,
      matchResult,
      state.tiebreakers
    );
    standingsUpdates.push({
      group_id: tournamentMatch.group_id,
      standings: groupStandings,
    });

    // Check if tournament is complete
    const newState = { ...state };
    newState.completed = this._checkAllGroupsComplete(state);

    return {
      state: newState,
      updatedMatches,
      newMatches: [],
      standingsUpdates,
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    return {
      type: 'groups',
      groups: groups.map((group) => ({
        id: group._id,
        name: group.name,
        standings: this._formatGroupStandings(group.standings),
        completed: group.completed,
      })),
    };
  }

  getNextPlayableMatches(state, matches) {
    return matches.filter(
      (match) => match.status === 'ready' || match.status === 'pending'
    );
  }

  isComplete(state) {
    return state.completed;
  }

  getFinalResults(state, groups = []) {
    // Combine all group results for final standings
    const allResults = [];

    groups.forEach((group, groupIndex) => {
      group.standings.forEach((standing, position) => {
        allResults.push({
          participant_id: standing.participant_id,
          name: standing.name,
          group: group.name,
          group_position: position + 1,
          wins: standing.wins,
          losses: standing.losses,
          games_won: standing.games_won,
          games_lost: standing.games_lost,
          points_won: standing.points_won,
          points_lost: standing.points_lost,
          game_differential: standing.games_won - standing.games_lost,
          point_differential: standing.points_won - standing.points_lost,
        });
      });
    });

    return allResults;
  }

  // Private helper methods

  _createGroups(participants, targetGroupSize) {
    if (participants.length <= targetGroupSize) {
      // Single group
      return [
        {
          name: 'Group A',
          participants: this._sortParticipants(participants),
          _id: 'group_a',
        },
      ];
    }

    // Multiple groups - distribute evenly
    const groupCount = Math.ceil(participants.length / targetGroupSize);
    const groups = [];
    const sortedParticipants = this._sortParticipants(participants);

    // Snake distribution to balance groups
    for (let i = 0; i < groupCount; i++) {
      groups.push({
        name: `Group ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
        participants: [],
        _id: `group_${String.fromCharCode(97 + i)}`, // group_a, group_b, etc.
      });
    }

    // Distribute participants using snake pattern
    sortedParticipants.forEach((participant, index) => {
      const groupIndex = this._getSnakeGroupIndex(index, groupCount);
      groups[groupIndex].participants.push(participant);
    });

    return groups;
  }

  _sortParticipants(participants) {
    return participants.sort((a, b) => {
      if (a.seed && b.seed) return a.seed - b.seed;
      if (a.seed && !b.seed) return -1;
      if (!a.seed && b.seed) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  _getSnakeGroupIndex(participantIndex, groupCount) {
    const row = Math.floor(participantIndex / groupCount);
    const col = participantIndex % groupCount;
    return row % 2 === 0 ? col : groupCount - 1 - col;
  }

  _generateRoundRobinFixtures(group, groupIndex) {
    const participants = group.participants;
    const matches = [];
    let matchNumber = 1;
    let round = 1;

    // Generate all possible pairings
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const match = {
          round: round,
          stage: 'group',
          match_number: `G${groupIndex + 1}M${matchNumber}`,
          group_id: group._id,
          participant_a: {
            type: 'participant',
            participant_id: participants[i]._id,
            name: participants[i].name,
          },
          participant_b: {
            type: 'participant',
            participant_id: participants[j]._id,
            name: participants[j].name,
          },
          status: 'ready',
          dependency_matches: [],
          feeds_to_matches: [],
        };

        matches.push(match);
        matchNumber++;

        // Distribute matches across rounds for better scheduling
        if (matchNumber % Math.floor(participants.length / 2) === 1) {
          round++;
        }
      }
    }

    return matches;
  }

  _calculateTotalRounds(groupSize) {
    // For round robin, total "rounds" is more about match distribution
    return Math.ceil((groupSize - 1) / 2);
  }

  _calculateGroupStandings(groupId, matchResult, tiebreakers) {
    // This would typically fetch all completed matches for the group
    // and recalculate standings. Simplified for now.
    return [];
  }

  _checkAllGroupsComplete(state) {
    // Check if all matches in all groups are completed
    return false; // Simplified implementation
  }

  _formatGroupStandings(standings) {
    return standings.map((standing, index) => ({
      position: index + 1,
      participant_id: standing.participant_id,
      name: standing.name,
      played: standing.played,
      wins: standing.wins,
      losses: standing.losses,
      games_won: standing.games_won,
      games_lost: standing.games_lost,
      game_differential: standing.games_won - standing.games_lost,
      points_won: standing.points_won,
      points_lost: standing.points_lost,
      point_differential: standing.points_won - standing.points_lost,
      walkovers_given: standing.walkovers_given,
      walkovers_received: standing.walkovers_received,
    }));
  }

  _applyTiebreakers(standings, tiebreakers) {
    return standings.sort((a, b) => {
      for (const tiebreaker of tiebreakers) {
        const result = this._compareTiebreaker(a, b, tiebreaker);
        if (result !== 0) return result;
      }
      return 0;
    });
  }

  _compareTiebreaker(a, b, tiebreaker) {
    switch (tiebreaker) {
      case 'wins':
        return b.wins - a.wins;
      case 'h2h':
        return this._compareHeadToHead(a, b);
      case 'game_diff':
        return b.games_won - b.games_lost - (a.games_won - a.games_lost);
      case 'point_diff':
        return b.points_won - b.points_lost - (a.points_won - a.points_lost);
      case 'fewest_walkovers':
        return a.walkovers_received - b.walkovers_received;
      case 'random':
        return Math.random() - 0.5;
      default:
        return 0;
    }
  }

  _compareHeadToHead(a, b) {
    // Compare direct matches between these two players
    if (a.head_to_head && a.head_to_head[b.participant_id]) {
      const h2h = a.head_to_head[b.participant_id];
      if (h2h.wins > h2h.losses) return -1;
      if (h2h.wins < h2h.losses) return 1;
    }
    return 0;
  }
}

module.exports = RoundRobinFormat;
