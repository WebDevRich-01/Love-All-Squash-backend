// Tournament formats whose matches are team fixtures (lineup confirm, strings,
// extras) rather than individual player matches.
const TEAM_FORMATS = new Set(['team_round_robin', 'team_round_robin_playoff']);

function deriveTournamentType(format) {
  return TEAM_FORMATS.has(format) ? 'team' : 'individual';
}

module.exports = { TEAM_FORMATS, deriveTournamentType };
