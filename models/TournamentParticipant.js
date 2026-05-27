const mongoose = require('mongoose');

const tournamentParticipantSchema = new mongoose.Schema({
  tournament_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true,
  },

  // Player details
  name: { type: String, required: true },
  seed: Number,
  club: String,
  external_ranking: String,
  color: { type: String, default: 'border-blue-500' }, // Reuse existing color system

  // Which division this team belongs to (team_round_robin only, 0-indexed)
  division_index: Number,

  // Pool player flag (team_round_robin only) — stand-in players not assigned to a team
  is_pool: { type: Boolean, default: false },

  // Player type for non-team participants (team_round_robin only)
  player_type: { type: String, enum: ['pool', 'racketball', 'beginner'] },

  // Team roster (team_round_robin tournaments only)
  roster: [
    {
      player_name: { type: String, required: true },
      string_number: { type: Number, required: true }, // 1–5
      is_captain: { type: Boolean, default: false },
    },
  ],

  // Status
  withdrawn: { type: Boolean, default: false },
  withdrawal_reason: String,
  withdrawal_date: Date,

  // Group assignment (for pools/round robin)
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentGroup' },

  created_at: { type: Date, default: Date.now },
});

// Compound indexes for efficient queries
tournamentParticipantSchema.index({ tournament_id: 1, seed: 1 });
tournamentParticipantSchema.index({ tournament_id: 1, group_id: 1 });
tournamentParticipantSchema.index({ tournament_id: 1, name: 1 });

module.exports = mongoose.model(
  'TournamentParticipant',
  tournamentParticipantSchema
);
