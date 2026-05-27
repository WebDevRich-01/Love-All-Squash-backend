const ITournamentFormat = require('../ITournamentFormat');

/**
 * Team Round Robin Format
 *
 * Teams compete in N divisions (default: 2). Every team plays every other team
 * in their division once. Standings are ranked by league points (2 per win,
 * 1 per draw), then game difference, then games won.
 *
 * A "fixture" between two teams consists of multiple individual string matches.
 * The fixture winner is determined by total games won across all strings.
 */
class TeamRoundRobinFormat extends ITournamentFormat {
  get id() {
    return 'team_round_robin';
  }

  get name() {
    return 'Team Round Robin';
  }

  validateConfig(config, participants) {
    const errors = [];
    const divCount = config.divisions?.count || 2;

    if (!participants || participants.length < divCount * 2) {
      errors.push(`Need at least 2 teams per division (${divCount * 2} total for ${divCount} divisions)`);
    }

    if (divCount < 1 || divCount > 8) {
      errors.push('Division count must be between 1 and 8');
    }

    return { valid: errors.length === 0, errors };
  }

  generateInitialState(config, participants) {
    const divCount = config.divisions?.count || 2;
    const divisions = this._createDivisions(participants, divCount);

    const matches = [];
    divisions.forEach((div, i) => {
      matches.push(...this._generateFixtures(div, i));
    });

    const state = {
      format: 'team_round_robin',
      divisionCount: divCount,
      completed: false,
    };

    return { state, matches, groups: divisions };
  }

  onMatchResult(state, tournamentMatch, matchResult, groups, allMatches) {
    const aId = tournamentMatch.participant_a.participant_id?.toString();
    const bId = tournamentMatch.participant_b.participant_id?.toString();
    const winnerId = matchResult.winner_id;
    const loserId = matchResult.loser_id;

    const aGames = matchResult.team_a_games_total ?? 0;
    const bGames = matchResult.team_b_games_total ?? 0;

    let aPoints, bPoints;
    if (aGames > bGames) {
      aPoints = 2; bPoints = 0;
    } else if (bGames > aGames) {
      aPoints = 0; bPoints = 2;
    } else {
      aPoints = 1; bPoints = 1; // draw
    }

    const updatedMatch = {
      ...tournamentMatch,
      _id: tournamentMatch._id,
      status: 'completed',
      completed_at: new Date(),
      result: {
        winner_participant_id: winnerId,
        winner_name: matchResult.winner_name,
        loser_participant_id: loserId,
        loser_name: matchResult.loser_name,
        string_results: matchResult.string_results || [],
        team_a_games_total: aGames,
        team_b_games_total: bGames,
        team_a_league_points: aId === winnerId?.toString() ? aPoints : bPoints,
        team_b_league_points: bId === winnerId?.toString() ? bPoints : aPoints,
        walkover: matchResult.walkover || false,
      },
    };

    // Merge the updated match into allMatches for standings recalculation
    const mergedMatches = allMatches.map((m) =>
      m._id.toString() === tournamentMatch._id.toString() ? updatedMatch : m
    );

    const standingsUpdates = groups.map((group) => ({
      group_id: group._id,
      standings: this._calculateStandings(group, mergedMatches),
      completed: this._isGroupComplete(group, mergedMatches),
    }));

    const allComplete = standingsUpdates.every((s) => s.completed);

    return {
      state: { ...state, completed: allComplete },
      updatedMatches: [updatedMatch],
      newMatches: [],
      standingsUpdates,
      tournamentComplete: allComplete,
    };
  }

  updateMatchResult(state, tournamentMatch, newMatchResult, allMatches) {
    // Delegate to onMatchResult — same recalculation logic
    return this.onMatchResult(state, tournamentMatch, newMatchResult, [], allMatches);
  }

  getStandings(state, groups = []) {
    return {
      type: 'team_divisions',
      groups: groups.map((group) => ({
        id: group._id,
        name: group.name,
        standings: group.standings || [],
        completed: group.completed,
      })),
    };
  }

  getNextPlayableMatches(state, matches) {
    // All non-completed fixtures are "playable" — no dependency ordering in RR
    return matches.filter(
      (m) => m.status === 'pending' || m.status === 'ready'
    );
  }

  isComplete(state) {
    return state.completed === true;
  }

  getFinalResults(state, groups = []) {
    const results = [];
    groups.forEach((group) => {
      (group.standings || []).forEach((standing, idx) => {
        results.push({
          participant_id: standing.participant_id,
          name: standing.name,
          group: group.name,
          group_position: idx + 1,
          league_points: standing.league_points,
          wins: standing.wins,
          losses: standing.losses,
          draws: standing.draws,
          games_won: standing.games_won,
          games_lost: standing.games_lost,
          game_differential: standing.games_won - standing.games_lost,
        });
      });
    });
    return results;
  }

  serialize(state) {
    return state;
  }

  deserialize(blob) {
    return blob;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _createDivisions(participants, divCount) {
    const divisions = Array.from({ length: divCount }, (_, i) => ({
      name: `Division ${String.fromCharCode(65 + i)}`,
      _id: `div_${String.fromCharCode(97 + i)}`,
      participants: [],
    }));

    // If participants carry explicit division_index assignments, honour them
    const hasExplicitAssignment = participants.some((p) => p.division_index != null);

    if (hasExplicitAssignment) {
      participants.forEach((p) => {
        const idx = p.division_index != null ? Math.min(p.division_index, divCount - 1) : 0;
        divisions[idx].participants.push(p);
      });
      return divisions;
    }

    // Fallback: snake distribution by seed
    const sorted = [...participants].sort((a, b) => {
      if (a.seed && b.seed) return a.seed - b.seed;
      if (a.seed) return -1;
      if (b.seed) return 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach((p, idx) => {
      const row = Math.floor(idx / divCount);
      const col = idx % divCount;
      const divIdx = row % 2 === 0 ? col : divCount - 1 - col;
      divisions[divIdx].participants.push(p);
    });

    return divisions;
  }

  _generateFixtures(division, divIndex) {
    const teams = division.participants;
    const fixtures = [];
    let fixtureNum = 1;

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        fixtures.push({
          round: 1,
          stage: 'group',
          match_number: `D${divIndex + 1}F${fixtureNum}`,
          group_id: division._id,
          participant_a: {
            type: 'participant',
            participant_id: teams[i]._id,
            name: teams[i].name,
          },
          participant_b: {
            type: 'participant',
            participant_id: teams[j]._id,
            name: teams[j].name,
          },
          status: 'ready',
          dependency_matches: [],
          feeds_to_matches: [],
        });
        fixtureNum++;
      }
    }

    return fixtures;
  }

  _calculateStandings(group, allMatches) {
    const groupIdStr = group._id.toString();

    // All completed fixtures in this division
    const fixtures = allMatches.filter(
      (m) =>
        m.group_id?.toString() === groupIdStr &&
        m.status === 'completed'
    );

    // Preserve names from stored standings for teams that haven't played yet
    const existingNames = {};
    (group.standings || []).forEach((s) => {
      if (s.participant_id && s.name) existingNames[s.participant_id.toString()] = s.name;
    });

    // Seed stats map from participant_ids on the group
    const stats = {};
    group.participant_ids.forEach((pid) => {
      const id = pid.toString();
      stats[id] = {
        participant_id: pid,
        name: existingNames[id] || '',
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        league_points: 0,
        games_won: 0,
        games_lost: 0,
      };
    });

    fixtures.forEach((fixture) => {
      const aId = fixture.participant_a?.participant_id?.toString();
      const bId = fixture.participant_b?.participant_id?.toString();
      if (!aId || !bId || !stats[aId] || !stats[bId]) return;

      // Resolve names from match data (populated as matches are played)
      if (fixture.participant_a.name) stats[aId].name = fixture.participant_a.name;
      if (fixture.participant_b.name) stats[bId].name = fixture.participant_b.name;

      const aGames = fixture.result?.team_a_games_total ?? 0;
      const bGames = fixture.result?.team_b_games_total ?? 0;

      stats[aId].played++;
      stats[bId].played++;
      stats[aId].games_won += aGames;
      stats[aId].games_lost += bGames;
      stats[bId].games_won += bGames;
      stats[bId].games_lost += aGames;

      if (aGames > bGames) {
        stats[aId].wins++;        stats[aId].league_points += 2;
        stats[bId].losses++;
      } else if (bGames > aGames) {
        stats[bId].wins++;        stats[bId].league_points += 2;
        stats[aId].losses++;
      } else {
        stats[aId].draws++;       stats[aId].league_points += 1;
        stats[bId].draws++;       stats[bId].league_points += 1;
      }
    });

    // Fill in names from match participant data for unplayed teams via the
    // group's participant list (names may not appear in stats yet if team
    // hasn't played). We can't resolve these here without the participant
    // docs — the route initialises standings with names on start, so
    // existing entries will have names already.

    const sorted = Object.values(stats).sort((a, b) => {
      // 1. League points
      if (b.league_points !== a.league_points) return b.league_points - a.league_points;
      // 2. Game difference
      const aDiff = a.games_won - a.games_lost;
      const bDiff = b.games_won - b.games_lost;
      if (bDiff !== aDiff) return bDiff - aDiff;
      // 3. Games won
      return b.games_won - a.games_won;
    });

    return sorted.map((s, i) => ({ ...s, position: i + 1 }));
  }

  _isGroupComplete(group, allMatches) {
    const groupIdStr = group._id.toString();
    const groupFixtures = allMatches.filter(
      (m) => m.group_id?.toString() === groupIdStr
    );
    return (
      groupFixtures.length > 0 &&
      groupFixtures.every((m) => m.status === 'completed' || m.status === 'walkover')
    );
  }
}

module.exports = TeamRoundRobinFormat;
