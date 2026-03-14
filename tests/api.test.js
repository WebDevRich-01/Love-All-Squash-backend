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

const makeParticipants = (count) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    seed: i + 1,
  }));

const validSETournament = (overrides = {}) => ({
  name: 'Test SE Tournament',
  format: 'single_elimination',
  participants: makeParticipants(8),
  ...overrides,
});

const validMonradTournament = (overrides = {}) => ({
  name: 'Test Monrad Tournament',
  format: 'monrad',
  participants: makeParticipants(8),
  ...overrides,
});

// ─── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  // Require app after setting MONGODB_URI so the connect() fires
  app = require('../server');
  await mongoose.connect(process.env.MONGODB_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  // Clear all collections between tests
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

// ─── GET /api/tournaments/formats ─────────────────────────────────────────────

describe('GET /api/tournaments/formats', () => {
  it('returns only single_elimination and monrad', async () => {
    const res = await request(app).get('/api/tournaments/formats').expect(200);
    const ids = res.body.map((f) => f.id);
    expect(ids).toContain('single_elimination');
    expect(ids).toContain('monrad');
    expect(ids).not.toContain('round_robin');
    expect(ids).not.toContain('pools_knockout');
  });
});

// ─── POST /api/tournaments ────────────────────────────────────────────────────

describe('POST /api/tournaments', () => {
  it('creates a single-elimination tournament with 4 Round 1 matches for 8 players', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send(validSETournament())
      .expect(201);

    expect(res.body.tournament.name).toBe('Test SE Tournament');
    expect(res.body.tournament.format).toBe('single_elimination');
    expect(res.body.tournament.status).toBe('active');
    expect(res.body.participants).toHaveLength(8);
    // 8-player SE generates 7 matches upfront (4 R1, 2 R2, 1 R3)
    expect(res.body.matches).toHaveLength(7);
    const r1 = res.body.matches.filter((m) => m.round === 1);
    expect(r1).toHaveLength(4);
    r1.forEach((m) => expect(m.status).toBe('ready'));
    const r2 = res.body.matches.filter((m) => m.round === 2);
    r2.forEach((m) => expect(m.status).toBe('pending'));
  });

  it('creates a Monrad tournament with 4 Round 1 matches for 8 players', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send(validMonradTournament())
      .expect(201);

    expect(res.body.tournament.format).toBe('monrad');
    expect(res.body.matches).toHaveLength(4);
    res.body.matches.forEach((m) => {
      expect(m.round).toBe(1);
      expect(m.status).toBe('ready');
      expect(m.participant_a.type).toBe('participant');
      expect(m.participant_b.type).toBe('participant');
    });
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ format: 'single_elimination', participants: makeParticipants(8) })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.some((d) => d.field === 'name')).toBe(true);
  });

  it('returns 400 when format is invalid', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'Bad', format: 'round_robin', participants: makeParticipants(8) })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.some((d) => d.field === 'format')).toBe(true);
  });

  it('returns 400 when fewer than 4 participants', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'Small', format: 'single_elimination', participants: makeParticipants(3) })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when participants have duplicate seeds', async () => {
    const participants = makeParticipants(8);
    participants[1].seed = 1; // duplicate seed 1
    const res = await request(app)
      .post('/api/tournaments')
      .send({ name: 'Dup', format: 'single_elimination', participants })
      .expect(400);

    expect(res.body.error).toMatch(/validation failed/i);
  });
});

// ─── GET /api/tournaments/:id ─────────────────────────────────────────────────

describe('GET /api/tournaments/:id', () => {
  it('returns 404 for unknown id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app).get(`/api/tournaments/${fakeId}`).expect(404);
  });

  it('returns full tournament detail', async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    const id = create.body.tournament._id;

    const res = await request(app).get(`/api/tournaments/${id}`).expect(200);
    expect(res.body.tournament._id).toBe(id);
    expect(res.body.participants).toHaveLength(8);
    expect(res.body.matches).toHaveLength(7);
  });
});

// ─── POST /api/tournaments/:id/matches/:matchId/result ────────────────────────

describe('POST tournament match result', () => {
  let tournamentId;
  let matches;

  beforeEach(async () => {
    const create = await request(app).post('/api/tournaments').send(validSETournament()).expect(201);
    tournamentId = create.body.tournament._id;
    matches = create.body.matches;
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

    // Verify match is now completed in DB
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
    // Submit only Round 1 matches
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
      .send({
        winner_id: fakeWinnerId,
        loser_id: fakeLoserId,
        walkover: false,
      })
      .expect(404);
  });
});

// ─── Monrad: Round 2 generation ───────────────────────────────────────────────

describe('Monrad: Round 2 generated after Round 1 completes', () => {
  it('generates 4 Round 2 matches after all Round 1 results submitted', async () => {
    const create = await request(app)
      .post('/api/tournaments')
      .send(validMonradTournament())
      .expect(201);
    const tournamentId = create.body.tournament._id;
    const matches = create.body.matches;

    // Submit all Round 1 results (participant_a wins each)
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
    const create = await request(app)
      .post('/api/tournaments')
      .send(validMonradTournament())
      .expect(201);
    const tournamentId = create.body.tournament._id;
    const matches = create.body.matches;

    // Submit first 2 Round 1 matches — 2 players have 1 win each
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
    // Monrad returns an array of group standings: [{ type, title, data: [...players] }]
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const standings = res.body[0].data;
    expect(Array.isArray(standings)).toBe(true);
    expect(standings.length).toBeGreaterThan(0);
    // Top-ranked player should have wins and a rank
    const top = standings[0];
    expect(top).toHaveProperty('rank');
    expect(top.wins).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for unknown tournament', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app).get(`/api/tournaments/${fakeId}/standings`).expect(404);
  });
});
