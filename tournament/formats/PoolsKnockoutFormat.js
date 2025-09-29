const ITournamentFormat = require('../ITournamentFormat');

/**
 * Pools → Knockout Tournament Format
 *
 * Features:
 * - Phase 1: Round-robin in groups/pools
 * - Phase 2: Top N from each group advance to knockout
 * - Optional consolation/plate for non-qualifiers
 * - Group separation rules for knockout seeding
 */
class PoolsKnockoutFormat extends ITournamentFormat {
  get id() {
    return 'pools_knockout';
  }

  get name() {
    return 'Pools → Knockout';
  }

  validateConfig(config, participants) {
    const errors = [];

    if (!participants || participants.length < 8) {
      errors.push('At least 8 participants required for pools → knockout');
    }

    const targetGroupSize = config.groups?.target_size || 4;
    if (targetGroupSize < 3) {
      errors.push('Pool size must be at least 3');
    }

    const advancePerGroup = config.groups?.advance_per_group || 2;
    if (advancePerGroup >= targetGroupSize) {
      errors.push('Advance count must be less than pool size');
    }

    const totalQualifiers =
      Math.floor(participants.length / targetGroupSize) * advancePerGroup;
    if (totalQualifiers < 4) {
      errors.push('Not enough qualifiers for knockout phase');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  generateInitialState(config, participants) {
    const groupSize = config.groups?.target_size || 4;
    const advancePerGroup = config.groups?.advance_per_group || 2;
    const groups = this._createGroups(participants, groupSize);

    // Generate pool matches
    const poolMatches = [];
    groups.forEach((group, groupIndex) => {
      const groupMatches = this._generatePoolMatches(group, groupIndex);
      poolMatches.push(...groupMatches);
    });

    const totalQualifiers = groups.length * advancePerGroup;
    const knockoutDrawSize = this._getKnockoutDrawSize(totalQualifiers);

    const state = {
      format: 'pools_knockout',
      phase: 'pools', // 'pools' or 'knockout'
      groupCount: groups.length,
      advancePerGroup,
      totalQualifiers,
      knockoutDrawSize,
      poolsComplete: false,
      knockoutGenerated: false,
      completed: false,
    };

    return { state, matches: poolMatches, groups };
  }

  onMatchResult(state, tournamentMatch, matchResult) {
    const updatedMatches = [];
    const newMatches = [];
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

    const newState = { ...state };

    if (state.phase === 'pools') {
      // Update pool standings
      const groupStandings = this._calculatePoolStandings(
        tournamentMatch.group_id,
        matchResult
      );
      standingsUpdates.push({
        group_id: tournamentMatch.group_id,
        standings: groupStandings,
      });

      // Check if all pools are complete
      if (this._areAllPoolsComplete(newState)) {
        newState.poolsComplete = true;

        // Generate knockout matches
        const knockoutMatches = this._generateKnockoutMatches(
          newState,
          standingsUpdates
        );
        newMatches.push(...knockoutMatches);

        newState.phase = 'knockout';
        newState.knockoutGenerated = true;
      }
    } else {
      // Knockout phase - advance winner
      const knockoutUpdates = this._processKnockoutResult(
        newState,
        tournamentMatch,
        matchResult
      );
      updatedMatches.push(...knockoutUpdates.updatedMatches);
      newMatches.push(...knockoutUpdates.newMatches);

      if (knockoutUpdates.tournamentComplete) {
        newState.completed = true;
      }
    }

    return {
      state: newState,
      updatedMatches,
      newMatches,
      standingsUpdates,
      tournamentComplete: newState.completed,
    };
  }

  getStandings(state, groups = []) {
    if (state.phase === 'pools') {
      return {
        type: 'pools',
        phase: 'pools',
        groups: groups.map((group) => ({
          id: group._id,
          name: group.name,
          standings: this._formatPoolStandings(group.standings),
          completed: group.completed,
          qualifiers: group.standings
            .slice(0, state.advancePerGroup)
            .map((s) => s.name),
        })),
      };
    } else {
      return {
        type: 'knockout',
        phase: 'knockout',
        bracket: this._generateKnockoutBracket(state),
      };
    }
  }

  getNextPlayableMatches(state, matches) {
    if (state.phase === 'pools') {
      return matches.filter(
        (match) =>
          match.stage === 'group' &&
          (match.status === 'ready' || match.status === 'pending')
      );
    } else {
      return matches.filter(
        (match) => match.stage === 'main' && match.status === 'ready'
      );
    }
  }

  isComplete(state) {
    return state.completed;
  }

  getFinalResults(state, groups = []) {
    const results = [];

    // Add knockout results first (higher placements)
    const knockoutResults = this._getKnockoutResults(state);
    results.push(...knockoutResults);

    // Add pool results for non-qualifiers
    const poolResults = this._getPoolResults(state, groups);
    results.push(...poolResults);

    return results;
  }

  // Private helper methods

  _createGroups(participants, targetGroupSize) {
    const groupCount = Math.ceil(participants.length / targetGroupSize);
    const groups = [];
    const sortedParticipants = this._sortParticipants(participants);

    // Create empty groups
    for (let i = 0; i < groupCount; i++) {
      groups.push({
        name: `Pool ${String.fromCharCode(65 + i)}`, // Pool A, Pool B, etc.
        participants: [],
        _id: `pool_${String.fromCharCode(97 + i)}`,
      });
    }

    // Snake distribution
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

  _generatePoolMatches(group, groupIndex) {
    const participants = group.participants;
    const matches = [];
    let matchNumber = 1;

    // Generate all vs all matches
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const match = {
          round: 1, // Pools can be thought of as one "round"
          stage: 'group',
          match_number: `P${groupIndex + 1}M${matchNumber}`,
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
      }
    }

    return matches;
  }

  _getKnockoutDrawSize(qualifierCount) {
    return Math.pow(2, Math.ceil(Math.log2(qualifierCount)));
  }

  _calculatePoolStandings(groupId, matchResult) {
    // Simplified - would recalculate full pool standings
    return [];
  }

  _areAllPoolsComplete(state) {
    // Check if all pool matches are completed
    return false; // Simplified implementation
  }

  _generateKnockoutMatches(state, standings) {
    // Generate knockout bracket from pool qualifiers
    // Apply group separation rules
    return []; // Simplified implementation
  }

  _processKnockoutResult(state, match, result) {
    // Handle knockout advancement
    return {
      updatedMatches: [],
      newMatches: [],
      tournamentComplete: false,
    };
  }

  _formatPoolStandings(standings) {
    return standings.map((standing, index) => ({
      position: index + 1,
      participant_id: standing.participant_id,
      name: standing.name,
      played: standing.played,
      wins: standing.wins,
      losses: standing.losses,
      qualified: index < 2, // Assuming top 2 qualify
    }));
  }

  _generateKnockoutBracket(state) {
    return {
      drawSize: state.knockoutDrawSize,
      currentRound: 1,
    };
  }

  _getKnockoutResults(state) {
    return []; // Extract from knockout bracket
  }

  _getPoolResults(state, groups) {
    return []; // Extract from pool standings
  }
}

module.exports = PoolsKnockoutFormat;
