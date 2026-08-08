const ITournamentFormat = require('../ITournamentFormat');
const { computeFixtureScoring, buildFixtureResult } = require('./teamFixtureScoring');

/**
 * Team Round Robin Playoff
 *
 * A fixed knockout stage that follows a completed Team Round Robin season with
 * exactly 2 divisions of 4 teams. Places 1-4 are decided by the "Pint" bracket
 * (built from each division's 1st/2nd place teams), places 5-8 by the
 * "Half-Pint" bracket (built from each division's 3rd/4th place teams). Each
 * bracket is a 4-team single-elimination shape with a 3rd/4th (or 7th/8th)
 * consolation match between the two semi-final losers.
 *
 * Every match is a team fixture (5 strings + optional racketball/beginner
 * extras), scored identically to Team Round Robin via the shared
 * teamFixtureScoring helper. The submitted winner_id is trusted as-is (see
 * teamFixtureScoring/TeamRoundRobinFormat) rather than re-derived here, so the
 * one true definition of "who won a fixture" stays in one place.
 */

// Which match each semi-final feeds into, and which slot (a/b) it occupies there.
const ADVANCEMENT = {
  'PINT-SF-A': { winnerTarget: 'PINT-F', loserTarget: 'PINT-3V4', slot: 'a' },
  'PINT-SF-B': { winnerTarget: 'PINT-F', loserTarget: 'PINT-3V4', slot: 'b' },
  'HP-SF-A': { winnerTarget: 'HP-F', loserTarget: 'HP-7V8', slot: 'a' },
  'HP-SF-B': { winnerTarget: 'HP-F', loserTarget: 'HP-7V8', slot: 'b' },
};

// The 4 matches whose winners/losers decide final tournament placement.
const TERMINAL_MATCHES = [
  { matchNumber: 'PINT-F', winnerPosition: 1, loserPosition: 2 },
  { matchNumber: 'PINT-3V4', winnerPosition: 3, loserPosition: 4 },
  { matchNumber: 'HP-F', winnerPosition: 5, loserPosition: 6 },
  { matchNumber: 'HP-7V8', winnerPosition: 7, loserPosition: 8 },
];

class TeamRoundRobinPlayoffFormat extends ITournamentFormat {
  get id() {
    return 'team_round_robin_playoff';
  }

  get name() {
    return 'Team Round Robin Playoff';
  }

  validateConfig(config, participants) {
    const errors = [];
    const list = participants || [];

    if (list.length !== 8) {
      errors.push('Exactly 8 teams are required (4 per division)');
    }

    const byDivision = { 0: [], 1: [] };
    let unassigned = 0;
    list.forEach((p) => {
      if (p.division_index === 0 || p.division_index === 1) {
        byDivision[p.division_index].push(p);
      } else {
        unassigned++;
      }
    });

    if (unassigned > 0) {
      errors.push('Every team must have division_index 0 or 1');
    }

    [0, 1].forEach((divIndex) => {
      const teams = byDivision[divIndex];
      const label = divIndex === 0 ? 'A' : 'B';
      if (teams.length !== 4) {
        errors.push(`Division ${label} must have exactly 4 teams (found ${teams.length})`);
        return;
      }
      const seeds = teams.map((t) => t.seed).slice().sort((a, b) => a - b);
      const seedsValid = [1, 2, 3, 4].every((expected, i) => seeds[i] === expected);
      if (!seedsValid) {
        errors.push(`Division ${label} must have finishing positions 1-4, each used exactly once`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  generateInitialState(config, participants) {
    const divisions = [[], []];
    participants.forEach((p) => {
      divisions[p.division_index].push(p);
    });
    divisions.forEach((div) => div.sort((a, b) => a.seed - b.seed));
    const [div0, div1] = divisions;
    const bySeed = (div, seed) => div[seed - 1];

    const teamRef = (team) => ({ type: 'participant', participant_id: team._id, name: team.name });
    const tbd = () => ({ type: 'tbd', name: 'TBD' });

    const matches = [
      {
        round: 1,
        stage: 'main',
        match_number: 'PINT-SF-A',
        participant_a: teamRef(bySeed(div0, 1)),
        participant_b: teamRef(bySeed(div1, 2)),
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 1,
        stage: 'main',
        match_number: 'PINT-SF-B',
        participant_a: teamRef(bySeed(div0, 2)),
        participant_b: teamRef(bySeed(div1, 1)),
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 2,
        stage: 'main',
        match_number: 'PINT-F',
        participant_a: tbd(),
        participant_b: tbd(),
        status: 'pending',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 2,
        stage: 'main',
        match_number: 'PINT-3V4',
        participant_a: tbd(),
        participant_b: tbd(),
        status: 'pending',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 1,
        stage: 'plate',
        match_number: 'HP-SF-A',
        participant_a: teamRef(bySeed(div0, 3)),
        participant_b: teamRef(bySeed(div1, 4)),
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 1,
        stage: 'plate',
        match_number: 'HP-SF-B',
        participant_a: teamRef(bySeed(div0, 4)),
        participant_b: teamRef(bySeed(div1, 3)),
        status: 'ready',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 2,
        stage: 'plate',
        match_number: 'HP-F',
        participant_a: tbd(),
        participant_b: tbd(),
        status: 'pending',
        dependency_matches: [],
        feeds_to_matches: [],
      },
      {
        round: 2,
        stage: 'plate',
        match_number: 'HP-7V8',
        participant_a: tbd(),
        participant_b: tbd(),
        status: 'pending',
        dependency_matches: [],
        feeds_to_matches: [],
      },
    ];

    const state = { format: 'team_round_robin_playoff', completed: false, finalPlacements: null };
    return { state, matches, groups: [] };
  }

  onMatchResult(state, tournamentMatch, matchResult, groups, allMatches) {
    const scoring = computeFixtureScoring(tournamentMatch, matchResult);
    const result = buildFixtureResult(tournamentMatch, matchResult, scoring);

    const isEdit = tournamentMatch.status === 'completed';
    const previousWinnerId = tournamentMatch.result?.winner_participant_id?.toString();
    const newWinnerId = result.winner_participant_id;

    const updatedMatch = {
      ...tournamentMatch,
      _id: tournamentMatch._id,
      status: 'completed',
      completed_at: new Date(),
      result,
    };
    const updatedMatches = [updatedMatch];

    const advancement = ADVANCEMENT[tournamentMatch.match_number];
    if (advancement && !(isEdit && previousWinnerId === newWinnerId)) {
      const winnerTarget = allMatches.find((m) => m.match_number === advancement.winnerTarget);
      const loserTarget = allMatches.find((m) => m.match_number === advancement.loserTarget);

      if (isEdit) {
        const downstreamPlayed = [winnerTarget, loserTarget].some(
          (m) => m && (m.status === 'completed' || m.status === 'walkover')
        );
        if (downstreamPlayed) {
          const error = new Error(
            `Cannot change this result: ${advancement.winnerTarget}/${advancement.loserTarget} has already been played. Reset it first.`
          );
          error.code = 'BRACKET_LOCKED';
          throw error;
        }
      }

      const slotField = advancement.slot === 'a' ? 'participant_a' : 'participant_b';
      const otherField = slotField === 'participant_a' ? 'participant_b' : 'participant_a';

      const applySlot = (target, participantId, name) => {
        const updated = {
          ...target,
          [slotField]: { type: 'participant', participant_id: participantId, name },
          dependency_matches: Array.from(
            new Set([...(target.dependency_matches || []).map(String), String(tournamentMatch._id)])
          ),
        };
        const otherFilled = updated[otherField] && updated[otherField].type === 'participant';
        updated.status = otherFilled ? 'ready' : 'pending';
        return updated;
      };

      if (winnerTarget) {
        updatedMatches.push(applySlot(winnerTarget, result.winner_participant_id, result.winner_name));
      }
      if (loserTarget) {
        updatedMatches.push(applySlot(loserTarget, result.loser_participant_id, result.loser_name));
      }
    }

    // Merge this call's updates into the full match list to evaluate completeness/placements.
    const effectiveMatches = allMatches.map((m) => {
      const updated = updatedMatches.find((u) => u.match_number === m.match_number);
      return updated ? { ...m, ...updated } : m;
    });

    const terminalMatches = TERMINAL_MATCHES.map(({ matchNumber }) =>
      effectiveMatches.find((m) => m.match_number === matchNumber)
    );
    const allTerminalComplete = terminalMatches.every(
      (m) => m && (m.status === 'completed' || m.status === 'walkover') && m.result
    );

    let finalPlacements = state.finalPlacements || null;
    if (allTerminalComplete) {
      finalPlacements = [];
      TERMINAL_MATCHES.forEach(({ winnerPosition, loserPosition }, i) => {
        const m = terminalMatches[i];
        finalPlacements.push({
          position: winnerPosition,
          participant_id: m.result.winner_participant_id,
          name: m.result.winner_name,
        });
        finalPlacements.push({
          position: loserPosition,
          participant_id: m.result.loser_participant_id,
          name: m.result.loser_name,
        });
      });
      finalPlacements.sort((a, b) => a.position - b.position);
    }

    const newState = { ...state, completed: allTerminalComplete, finalPlacements };

    return {
      state: newState,
      updatedMatches,
      newMatches: [],
      standingsUpdates: [],
      tournamentComplete: allTerminalComplete,
    };
  }

  updateMatchResult(state, tournamentMatch, newMatchResult, allMatches) {
    return this.onMatchResult(state, tournamentMatch, newMatchResult, [], allMatches);
  }

  getStandings(state) {
    return {
      type: 'team_round_robin_playoff',
      completed: !!state.completed,
      finalPlacements: state.finalPlacements || null,
    };
  }

  getNextPlayableMatches(state, matches) {
    return matches.filter((m) => m.status === 'ready');
  }

  isComplete(state) {
    return state.completed === true;
  }

  getFinalResults(state) {
    return state.finalPlacements || [];
  }

  serialize(state) {
    return state;
  }

  deserialize(blob) {
    return blob;
  }
}

module.exports = TeamRoundRobinPlayoffFormat;
