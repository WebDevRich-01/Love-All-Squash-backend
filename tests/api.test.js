/**
 * Integration tests for key API routes.
 * Uses an in-memory MongoDB so no external database is required.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

let mongod;
let app;

// ─── helpers ─────────────────────────────────────────────────────────────────

const TEST_PASSPHRASE = 'testpassword123';

const makeParticipants = (count) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    seed: i + 1,
  }));

const validSETournament = (overrides = {}) => ({
  name: 'Test SE Tournament',
  format: 'single_elimination',
  passphrase: TEST_PASSPHRASE,
  participants: makeParticipants(8),
  ...overrides,
});

const validMonradTournament = (overrides = {}) => ({
  name: 'Test Monrad Tournament',
  format: 'monrad',
  passphrase: TEST_PASSPHRASE,
  participants: makeParticipants(8),
  ...overrides,
});

// Division A (0): 1=A1..4=A4. Division B (1): 1=B1..4=B4.
const makePlayoffParticipants = () => [
  { name: 'Alpha 1st', division_index: 0, seed: 1 },
  { name: 'Alpha 2nd', division_index: 0, seed: 2 },
  { name: 'Alpha 3rd', division_index: 0, seed: 3 },
  { name: 'Alpha 4th', division_index: 0, seed: 4 },
  { name: 'Beta 1st', division_index: 1, seed: 1 },
  { name: 'Beta 2nd', division_index: 1, seed: 2 },
  { name: 'Beta 3rd', division_index: 1, seed: 3 },
  { name: 'Beta 4th', division_index: 1, seed: 4 },
];

const validPlayoffTournament = (overrides = {}) => ({
  name: 'Test Playoff Tournament',
  format: 'team_round_robin_playoff',
  passphrase: TEST_PASSPHRASE,
  participants: makePlayoffParticipants(),
  ...overrides,
});

const submitFixtureResult = (app, tournamentId, matchId, winnerId, winnerName, loserId, loserName) =>
  request(app)
    .post(`/api/tournaments/${tournamentId}/matches/${matchId}/result`)
    .send({
      winner_id: winnerId,
      winner_name: winnerName,
      loser_id: loserId,
      loser_name: loserName,
      team_a_games_total: 3,
      team_b_games_total: 0,
      string_results: [{ string_number: 1, team_a_games: 3, team_b_games: 0 }],
    });

// Create a tournament AND start it, returning { tournamentId, matches }
const createAndStart = async (payload) => {
  const create = await request(app).post('/api/tournaments').send(payload).expect(201);
  const tournamentId = create.body.tournament._id;
  const start = await request(app)
    .post(`/api/tournaments/${tournamentId}/start`)
    .send({ passphrase: TEST_PASSPHRASE })
    .expect(200);
  return { tournamentId, matches: start.body.matches };
};

// ─── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  app = require('../server');
  await mongoose.connect(process.env.MONGODB_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

// ─── GET /api/tournaments/formats ─────────────────────────────────────────────

describe('GET /api/tournaments/formats', () => {
  it('returns the production-ready formats, excluding unfinished ones', async () => {
    const res = await request(app).get('/api/tournaments/formats').expect(200);
    const ids = res.body.map((f) => f.id);
    expect(ids).toContain('single_elimination');
    expect(ids).toContain('monrad');
    expect(ids).toContain('team_round_robin');
    expect(ids).toContain('team_round_robin_playoff');
    expect(ids).not.toContain('round_robin');
    expect(ids).not.toContain('pools_knockout');
  });
});

// ─── POST /api/tournaments ────────────────────────────────────────────────────

describe('POST /api/tournaments', () => {
  it('creates a tournament as draft with no matches', async () => {
    const res = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    expect(res.body.tournament.status).toBe('draft');
    expect(res.body.participants).toHaveLength(8);
    expect(res.body.matches).toHaveLength(0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ format: 'single_elimination', passphrase: TEST_PASSPHRASE, participants: makeParticipants(8) })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.some((d) => d.field === 'name')).toBe(true);
  });

  it('returns 400 when passphrase is missing', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'No Pass', format: 'single_elimination', participants: makeParticipants(8) })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.some((d) => d.field === 'passphrase')).toBe(true);
  });

  it('returns 400 when format is invalid', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'Bad', format: 'round_robin', passphrase: TEST_PASSPHRASE, participants: makeParticipants(8) })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.some((d) => d.field === 'format')).toBe(true);
  });

  it('returns 400 when fewer than 4 participants', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'Small', format: 'single_elimination', passphrase: TEST_PASSPHRASE, participants: makeParticipants(3) })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ─── POST /api/tournaments/:id/verify-passphrase ──────────────────────────────

describe('POST /api/tournaments/:id/verify-passphrase', () => {
  it('returns valid: true for correct passphrase', async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    const id = create.body.tournament._id;
    const res = await request(app)
      .post(`/api/tournaments/${id}/verify-passphrase`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);
    expect(res.body.valid).toBe(true);
  });

  it('returns 401 for wrong passphrase', async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    const id = create.body.tournament._id;
    await request(app)
      .post(`/api/tournaments/${id}/verify-passphrase`)
      .send({ passphrase: 'wrongpassword' })
      .expect(401);
  });
});

// ─── POST /api/tournaments/:id/start ─────────────────────────────────────────

describe('POST /api/tournaments/:id/start', () => {
  it('starts a SE tournament — generates 7 matches and sets status active', async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    const id = create.body.tournament._id;

    const res = await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);

    expect(res.body.tournament.status).toBe('active');
    expect(res.body.matches).toHaveLength(7);
    const r1 = res.body.matches.filter((m) => m.round === 1);
    expect(r1).toHaveLength(4);
    r1.forEach((m) => expect(m.status).toBe('ready'));
    const r2 = res.body.matches.filter((m) => m.round === 2);
    r2.forEach((m) => expect(m.status).toBe('pending'));
  });

  it('starts a Monrad tournament — 4 Round 1 matches with real participants', async () => {
    const create = await request(app).post('/api/tournaments').send(validMonradTournament()).expect(201);
    const id = create.body.tournament._id;

    const res = await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);

    expect(res.body.tournament.status).toBe('active');
    expect(res.body.matches).toHaveLength(4);
    res.body.matches.forEach((m) => {
      expect(m.round).toBe(1);
      expect(m.status).toBe('ready');
      expect(m.participant_a.type).toBe('participant');
      expect(m.participant_b.type).toBe('participant');
    });
  });

  it('returns 401 for wrong passphrase', async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    const id = create.body.tournament._id;
    await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: 'wrongpassword' })
      .expect(401);
  });

  it('returns 400 if tournament already started', async () => {
    const { tournamentId } = await createAndStart(validSETournament());
    await request(app)
      .post(`/api/tournaments/${tournamentId}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(400);
  });
});

// ─── GET /api/tournaments/:id ─────────────────────────────────────────────────

describe('GET /api/tournaments/:id', () => {
  it('returns 404 for unknown id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app).get(`/api/tournaments/${fakeId}`).expect(404);
  });

  it('returns full tournament detail after starting', async () => {
    const { tournamentId } = await createAndStart(validSETournament());
    const res = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    expect(res.body.participants).toHaveLength(8);
    expect(res.body.matches).toHaveLength(7);
  });
});

// ─── POST /api/tournaments/:id/matches/:matchId/result ────────────────────────

describe('POST tournament match result', () => {
  let tournamentId;
  let matches;

  beforeEach(async () => {
    ({ tournamentId, matches } = await createAndStart(validSETournament()));
  });

  const submitResult = (matchId, winnerId, loserId) =>
    request(app)
      .post(`/api/tournaments/${tournamentId}/matches/${matchId}/result`)
      .send({
        winner_id: winnerId,
        loser_id: loserId,
        winner_name: 'Winner',
        loser_name: 'Loser',
        game_scores: [
          { player1: 11, player2: 5 },
          { player1: 11, player2: 7 },
          { player1: 11, player2: 3 },
        ],
        walkover: false,
      });

  it('marks a match as completed', async () => {
    const match = matches[0];
    const winnerId = match.participant_a.participant_id;
    const loserId = match.participant_b.participant_id;

    const res = await submitResult(match._id, winnerId, loserId).expect(200);
    expect(res.body.success).toBe(true);

    const detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    const updated = detail.body.matches.find((m) => m._id === match._id);
    expect(updated.status).toBe('completed');
    expect(updated.result.winner_participant_id).toBe(winnerId);
  });

  it('Round 2 matches exist as pending until Round 1 completes (SE pre-generates all rounds)', async () => {
    const detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    const round2Matches = detail.body.matches.filter((m) => m.round === 2);
    expect(round2Matches).toHaveLength(2);
    round2Matches.forEach((m) => expect(m.status).toBe('pending'));
  });

  it('advances bracket after all Round 1 matches complete (SE)', async () => {
    const r1Matches = matches.filter((m) => m.round === 1);
    for (const match of r1Matches) {
      await submitResult(
        match._id,
        match.participant_a.participant_id,
        match.participant_b.participant_id
      ).expect(200);
    }

    const detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    const round2 = detail.body.matches.filter((m) => m.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    round2.forEach((m) => expect(m.status).toBe('ready'));
  });

  it('returns 400 when winner_id equals loser_id', async () => {
    const match = matches[0];
    const id = match.participant_a.participant_id;
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/matches/${match._id}/result`)
      .send({ winner_id: id, loser_id: id, game_scores: [], walkover: false })
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 for unknown tournament', async () => {
    const fakeTournamentId = new mongoose.Types.ObjectId().toString();
    const fakeWinnerId = new mongoose.Types.ObjectId().toString();
    const fakeLoserId = new mongoose.Types.ObjectId().toString();
    await request(app)
      .post(`/api/tournaments/${fakeTournamentId}/matches/${matches[0]._id}/result`)
      .send({ winner_id: fakeWinnerId, loser_id: fakeLoserId, walkover: false })
      .expect(404);
  });
});

// ─── Monrad: Round 2 generation ───────────────────────────────────────────────

describe('Monrad: Round 2 generated after Round 1 completes', () => {
  it('generates 4 Round 2 matches after all Round 1 results submitted', async () => {
    const { tournamentId, matches } = await createAndStart(validMonradTournament());

    for (const match of matches) {
      await request(app)
        .post(`/api/tournaments/${tournamentId}/matches/${match._id}/result`)
        .send({
          winner_id: match.participant_a.participant_id,
          loser_id: match.participant_b.participant_id,
          winner_name: match.participant_a.name,
          loser_name: match.participant_b.name,
          game_scores: [{ player1: 11, player2: 5 }],
          walkover: false,
        })
        .expect(200);
    }

    const detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    const round2 = detail.body.matches.filter((m) => m.round === 2);
    expect(round2).toHaveLength(4);
    round2.forEach((m) => {
      expect(m.status).toBe('ready');
      expect(m.participant_a.type).toBe('participant');
      expect(m.participant_b.type).toBe('participant');
    });
  });
});

// ─── GET /api/tournaments/:id/standings ───────────────────────────────────────

describe('GET /api/tournaments/:id/standings', () => {
  it('returns correctly ranked standings after some Monrad results', async () => {
    const { tournamentId, matches } = await createAndStart(validMonradTournament());

    for (let i = 0; i < 2; i++) {
      const match = matches[i];
      await request(app)
        .post(`/api/tournaments/${tournamentId}/matches/${match._id}/result`)
        .send({
          winner_id: match.participant_a.participant_id,
          loser_id: match.participant_b.participant_id,
          winner_name: match.participant_a.name,
          loser_name: match.participant_b.name,
          game_scores: [{ player1: 11, player2: 5 }],
          walkover: false,
        });
    }

    const res = await request(app).get(`/api/tournaments/${tournamentId}/standings`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const standings = res.body[0].data;
    expect(Array.isArray(standings)).toBe(true);
    const top = standings[0];
    expect(top).toHaveProperty('rank');
    expect(top.wins).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for unknown tournament', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app).get(`/api/tournaments/${fakeId}/standings`).expect(404);
  });
});

// ─── Team Round Robin Playoff ─────────────────────────────────────────────────

describe('POST /api/tournaments/:id/start (team_round_robin_playoff)', () => {
  it('creates a team tournament and generates 4 ready semis + 4 pending TBD matches', async () => {
    const create = await request(app).post('/api/tournaments').send(validPlayoffTournament()).expect(201);
    expect(create.body.tournament.tournament_type).toBe('team');
    const id = create.body.tournament._id;

    const res = await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);

    expect(res.body.tournament.status).toBe('active');
    expect(res.body.matches).toHaveLength(8);
    const ready = res.body.matches.filter((m) => m.status === 'ready');
    const pending = res.body.matches.filter((m) => m.status === 'pending');
    expect(ready).toHaveLength(4);
    expect(pending).toHaveLength(4);
    pending.forEach((m) => {
      expect(m.participant_a.type).toBe('tbd');
      expect(m.participant_b.type).toBe('tbd');
    });
  });

  it('applies config.fixture_dates to the semi-final matches by match_number', async () => {
    const create = await request(app)
      .post('/api/tournaments')
      .send(validPlayoffTournament({
        config: {
          match: { best_of: 5, points_to_win: 15, clear_points: 2 },
          divisions: { count: 2 },
          fixture_dates: { 'PINT-SF-A': '2026-09-01', 'HP-SF-B': '2026-09-02' },
        },
      }))
      .expect(201);
    const id = create.body.tournament._id;

    const res = await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);

    const sfA = res.body.matches.find((m) => m.match_number === 'PINT-SF-A');
    const sfBHalfPint = res.body.matches.find((m) => m.match_number === 'HP-SF-B');
    const untouched = res.body.matches.find((m) => m.match_number === 'PINT-SF-B');
    expect(new Date(sfA.scheduled_at).toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(new Date(sfBHalfPint.scheduled_at).toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(untouched.scheduled_at).toBeUndefined();
  });

  it('starts successfully when pool/racketball/beginner extras are included alongside the 8 teams', async () => {
    const participants = [
      ...makePlayoffParticipants(),
      { name: 'Pool Player', is_pool: true, seed: 1 },
      { name: 'Racketball Player', player_type: 'racketball' },
      { name: 'Beginner Player', player_type: 'beginner' },
    ];
    const create = await request(app)
      .post('/api/tournaments')
      .send(validPlayoffTournament({ participants }))
      .expect(201);
    expect(create.body.participants).toHaveLength(11);
    const id = create.body.tournament._id;

    const res = await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);
    expect(res.body.tournament.status).toBe('active');
    expect(res.body.matches).toHaveLength(8);

    const detail = await request(app).get(`/api/tournaments/${id}`).expect(200);
    expect(detail.body.participants).toHaveLength(11);
    expect(detail.body.participants.some((p) => p.is_pool)).toBe(true);
    expect(detail.body.participants.some((p) => p.player_type === 'racketball')).toBe(true);
    expect(detail.body.participants.some((p) => p.player_type === 'beginner')).toBe(true);
  });

  it('returns 400 when a division does not have exactly 4 teams', async () => {
    const participants = makePlayoffParticipants();
    participants[3].division_index = 1; // 5 teams in division B, 3 in division A
    const create = await request(app)
      .post('/api/tournaments')
      .send(validPlayoffTournament({ participants }))
      .expect(201);
    const id = create.body.tournament._id;

    await request(app)
      .post(`/api/tournaments/${id}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(400);
  });
});

describe('Team Round Robin Playoff: full bracket playthrough', () => {
  it('advances winners through both brackets and reports correct final placements', async () => {
    const create = await request(app).post('/api/tournaments').send(validPlayoffTournament()).expect(201);
    const tournamentId = create.body.tournament._id;
    const start = await request(app)
      .post(`/api/tournaments/${tournamentId}/start`)
      .send({ passphrase: TEST_PASSPHRASE })
      .expect(200);

    const byNumber = (number) => start.body.matches.find((m) => m.match_number === number);
    const findByName = (match, name) =>
      match.participant_a.name === name ? match.participant_a : match.participant_b;

    // Play both semis in each bracket, Alpha teams winning throughout.
    const semis = [
      ['PINT-SF-A', 'Alpha 1st', 'Beta 2nd'],
      ['PINT-SF-B', 'Alpha 2nd', 'Beta 1st'],
      ['HP-SF-A', 'Alpha 3rd', 'Beta 4th'],
      ['HP-SF-B', 'Alpha 4th', 'Beta 3rd'],
    ];
    for (const [matchNumber, winnerName, loserName] of semis) {
      const match = byNumber(matchNumber);
      const winner = findByName(match, winnerName);
      const loser = findByName(match, loserName);
      await submitFixtureResult(
        app,
        tournamentId,
        match._id,
        winner.participant_id,
        winner.name,
        loser.participant_id,
        loser.name
      ).expect(200);
    }

    let detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    const findCurrent = (number) => detail.body.matches.find((m) => m.match_number === number);

    const finals = [
      ['PINT-F', 'Alpha 1st', 'Alpha 2nd'],
      ['PINT-3V4', 'Beta 2nd', 'Beta 1st'],
      ['HP-F', 'Alpha 3rd', 'Alpha 4th'],
      ['HP-7V8', 'Beta 4th', 'Beta 3rd'],
    ];
    let last;
    for (const [matchNumber, winnerName, loserName] of finals) {
      const match = findCurrent(matchNumber);
      expect(match.status).toBe('ready');
      const winner = findByName(match, winnerName);
      const loser = findByName(match, loserName);
      last = await submitFixtureResult(
        app,
        tournamentId,
        match._id,
        winner.participant_id,
        winner.name,
        loser.participant_id,
        loser.name
      ).expect(200);
    }

    expect(last.body.tournament_complete).toBe(true);

    detail = await request(app).get(`/api/tournaments/${tournamentId}`).expect(200);
    expect(detail.body.tournament.status).toBe('completed');

    const finalResults = await request(app).get(`/api/tournaments/${tournamentId}/final-results`).expect(200);
    expect(finalResults.body.map((r) => r.name)).toEqual([
      'Alpha 1st',
      'Alpha 2nd',
      'Beta 2nd',
      'Beta 1st',
      'Alpha 3rd',
      'Alpha 4th',
      'Beta 4th',
      'Beta 3rd',
    ]);
    expect(finalResults.body.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
