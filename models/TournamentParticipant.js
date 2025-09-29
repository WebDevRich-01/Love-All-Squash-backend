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

  // Status
  withdrawn: { type: Boolean, default: false },
  withdrawal_reason: String,
  withdrawal_date: Date,

  // Group assignment (for pools/round robin)
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentGroup' },

  created_at: { type: Date, default: Date.now },
});

// Compound index for efficient queries
tournamentParticipantSchema.index({ tournament_id: 1, seed: 1 });
tournamentParticipantSchema.index({ tournament_id: 1, group_id: 1 });

module.exports = mongoose.model(
  'TournamentParticipant',
  tournamentParticipantSchema
);
