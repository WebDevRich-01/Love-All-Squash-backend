const mongoose = require('mongoose');

const tournamentGroupSchema = new mongoose.Schema({
  tournament_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true,
  },

  name: { type: String, required: true }, // "Group A", "Pool 1", etc.
  stage: {
    type: String,
    default: 'group',
    enum: ['group', 'consolation', 'plate'],
  },

  // Participants in this group
  participant_ids: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentParticipant' },
  ],

  // Group settings
  advance_count: { type: Number, default: 2 }, // How many advance from this group

  // Current standings (materialized for performance)
  standings: [
    {
      participant_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TournamentParticipant',
      },
      name: String,
      position: Number,
      played: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      games_won: { type: Number, default: 0 },
      games_lost: { type: Number, default: 0 },
      points_won: { type: Number, default: 0 },
      points_lost: { type: Number, default: 0 },
      walkovers_given: { type: Number, default: 0 },
      walkovers_received: { type: Number, default: 0 },

      // Tiebreaker values
      head_to_head: { type: mongoose.Schema.Types.Mixed, default: {} },
      tiebreak_values: [Number], // Ordered by tiebreaker priority
    },
  ],

  // Status
  completed: { type: Boolean, default: false },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Update the updated_at field on save
tournamentGroupSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

tournamentGroupSchema.index({ tournament_id: 1, stage: 1 });

module.exports = mongoose.model('TournamentGroup', tournamentGroupSchema);
