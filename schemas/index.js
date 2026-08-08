const { z } = require('zod');

const FORMATS = ['single_elimination', 'monrad', 'team_round_robin', 'team_round_robin_playoff'];

// POST /api/matches
const matchSchema = z.object({
  player1Name: z.string().min(1).max(100),
  player2Name: z.string().min(1).max(100),
  player1Color: z.string().max(100).optional(),
  player2Color: z.string().max(100).optional(),
  gameScores: z
    .array(
      z.object({
        player1: z.number().int().min(0).max(99),
        player2: z.number().int().min(0).max(99),
      })
    )
    .max(5)
    .optional(),
  matchSettings: z.object({
    pointsToWin: z.number().int().min(1).max(99),
    clearPoints: z.number().int().min(0).max(10),
    bestOf: z.number().int().min(1).max(9),
    player1Serving: z.boolean().optional(),
  }),
  eventId: z.string().optional(),
  eventName: z.string().max(100).optional(),
});

// POST /api/events
const eventSchema = z.object({
  name: z.string().min(1).max(100),
});

// Shared participant schema (covers both individual players and teams)
const participantInputSchema = z.object({
  name: z.string().min(1).max(100),
  seed: z.number().int().min(1).optional(),
  club: z.string().max(100).optional(),
  color: z.string().max(100).optional(),
  // Team roster — array of players by string number
  roster: z
    .array(
      z.object({
        player_name: z.string().min(1).max(100),
        string_number: z.number().int().min(1).max(5),
        is_captain: z.boolean().optional(),
      })
    )
    .max(10)
    .optional(),
  // Team round robin: which division this participant belongs to (0-indexed)
  division_index: z.number().int().min(0).optional(),
  // Pool player (stand-in, not assigned to a team)
  is_pool: z.boolean().optional(),
  // Player type for non-team participants
  player_type: z.enum(['pool', 'racketball', 'beginner']).optional(),
});

// Shared match config schema
const matchConfigSchema = z
  .object({
    match: z
      .object({
        best_of: z.number().int().min(1).max(9).optional(),
        points_to_win: z.number().int().min(1).max(99).optional(),
        clear_points: z.number().int().min(0).max(10).optional(),
        is_handicap: z.boolean().optional(),
      })
      .optional(),
    divisions: z
      .object({
        count: z.number().int().min(1).max(8).optional(),
      })
      .optional(),
    fixture_dates: z.record(z.string(), z.string()).optional(),
  })
  .optional();

// POST /api/tournaments
const tournamentSchema = z.object({
  name: z.string().min(1).max(100),
  format: z.enum(FORMATS),
  passphrase: z.string().min(4).max(100),
  participants: z.array(participantInputSchema).min(2).max(64),
  config: matchConfigSchema,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  venue: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
});

// POST /api/tournaments/:id/verify-passphrase
const verifyPassphraseSchema = z.object({
  passphrase: z.string().min(1),
});

// POST /api/tournaments/:id/start
const startTournamentSchema = z.object({
  passphrase: z.string().min(1),
});

// PATCH /api/tournaments/:id
const tournamentUpdateSchema = z.object({
  passphrase: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  format: z.enum(FORMATS).optional(),
  config: matchConfigSchema,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  venue: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  participants: z.array(participantInputSchema).min(2).max(64).optional(),
});

// PATCH /api/tournaments/:id/participants/:participantId
const participantUpdateSchema = z.object({
  passphrase: z.string().min(1),
  name: z.string().min(1).max(100),
});

// PATCH /api/tournaments/:id/participants/:participantId/roster
const rosterUpdateSchema = z.object({
  passphrase: z.string().min(1),
  roster: z.array(
    z.object({
      player_name: z.string().min(1).max(100),
      string_number: z.number().int().min(1).max(5),
      is_captain: z.boolean().optional(),
    })
  ).min(1).max(10),
});

// POST /api/tournaments/:id/matches/:matchId/result (individual match)
const matchResultSchema = z
  .object({
    winner_id: z.string().min(1),
    loser_id: z.string().min(1),
    game_scores: z
      .array(
        z.object({
          player1: z.number().int().min(-99).max(999),
          player2: z.number().int().min(-99).max(999),
        })
      )
      .min(1)
      .max(5)
      .optional(),
    handicap_starts: z
      .object({
        player1: z.number().int().min(-99).max(99),
        player2: z.number().int().min(-99).max(99),
      })
      .optional(),
    passphrase: z.string().optional(),
  })
  .refine((data) => data.winner_id !== data.loser_id, {
    message: 'winner_id and loser_id must be different',
    path: ['loser_id'],
  });

// POST /api/tournaments/:id/matches/:matchId/result (team fixture)
const teamFixtureResultSchema = z
  .object({
    winner_id: z.string().min(1),
    loser_id: z.string().min(1),
    winner_name: z.string().max(100).optional(),
    loser_name: z.string().max(100).optional(),
    team_a_games_total: z.number().int().min(0),
    team_b_games_total: z.number().int().min(0),
    string_results: z
      .array(
        z.object({
          string_number: z.number().int().min(1).max(5),
          team_a_games: z.number().int().min(0).max(5),
          team_b_games: z.number().int().min(0).max(5),
          team_a_player: z.string().max(100).optional(),
          team_b_player: z.string().max(100).optional(),
          game_scores: z
            .array(z.object({ team_a: z.number().int().min(0), team_b: z.number().int().min(0) }))
            .optional(),
        })
      )
      .min(1)
      .max(6),
    passphrase: z.string().optional(),
  })
  .refine((data) => data.winner_id !== data.loser_id, {
    message: 'winner_id and loser_id must be different',
    path: ['loser_id'],
  });

module.exports = {
  matchSchema,
  eventSchema,
  tournamentSchema,
  verifyPassphraseSchema,
  startTournamentSchema,
  tournamentUpdateSchema,
  participantUpdateSchema,
  rosterUpdateSchema,
  matchResultSchema,
  teamFixtureResultSchema,
};
