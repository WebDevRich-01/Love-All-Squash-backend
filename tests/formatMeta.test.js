const { TEAM_FORMATS, deriveTournamentType } = require('../tournament/formatMeta');

describe('deriveTournamentType', () => {
  it('returns "team" for team_round_robin', () => {
    expect(deriveTournamentType('team_round_robin')).toBe('team');
  });

  it('returns "team" for team_round_robin_playoff', () => {
    expect(deriveTournamentType('team_round_robin_playoff')).toBe('team');
  });

  it('returns "individual" for single_elimination', () => {
    expect(deriveTournamentType('single_elimination')).toBe('individual');
  });

  it('returns "individual" for monrad', () => {
    expect(deriveTournamentType('monrad')).toBe('individual');
  });
});

describe('TEAM_FORMATS', () => {
  it('contains exactly the two team-based formats', () => {
    expect(TEAM_FORMATS.has('team_round_robin')).toBe(true);
    expect(TEAM_FORMATS.has('team_round_robin_playoff')).toBe(true);
    expect(TEAM_FORMATS.has('single_elimination')).toBe(false);
  });
});
