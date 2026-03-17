const { z } = require('zod');

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

// Shared participant schema
const participantInputSchema = z.object({
  name: z.string().min(1).max(100),
  seed: z.number().int().min(1).optional(),
  club: z.string().max(100).optional(),
  color: z.string().max(100).optional(),
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
  })
  .optional();

// POST /api/tournaments
const tournamentSchema = z.object({
  name: z.string().min(1).max(100),
  format: z.enum(['single_elimination', 'monrad']),
  passphrase: z.string().min(4).max(100),
  participants: z.array(participantInputSchema).min(4).max(32),
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
  format: z.enum(['single_elimination', 'monrad']).optional(),
  config: matchConfigSchema,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  venue: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  participants: z.array(participantInputSchema).min(4).max(32).optional(),
});

// PATCH /api/tournaments/:id/participants/:participantId
const participantUpdateSchema = z.object({
  passphrase: z.string().min(1),
  name: z.string().min(1).max(100),
});

// POST /api/tournaments/:id/matches/:matchId/result
const matchResultSchema = z
  .object({
    winner_id: z.string().min(1),
    loser_id: z.string().min(1),
    game_scores: z
      .array(
        z.object({
          player1: z.number().int().min(0).max(99),
          player2: z.number().int().min(0).max(99),
        })
      )
      .min(1)
      .max(5)
      .optional(),
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
  matchResultSchema,
};
