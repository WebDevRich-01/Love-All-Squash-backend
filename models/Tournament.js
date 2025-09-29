const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  format: {
    type: String,
    required: true,
    enum: [
      'single_elimination',
      'round_robin',
      'monrad',
      'pools_knockout',
      'double_elimination',
      'swiss',
    ],
  },
  status: {
    type: String,
    default: 'draft',
    enum: ['draft', 'active', 'completed', 'cancelled'],
  },

  // Tournament configuration
  config: {
    match: {
      best_of: { type: Number, default: 5 },
      points_to_win: { type: Number, default: 15 },
      clear_points: { type: Number, default: 2 },
      scoring: {
        type: String,
        default: 'traditional',
        enum: ['traditional', 'PAR11'],
      },
    },

    // Format-specific configs
    groups: {
      target_size: { type: Number, default: 4 },
      advance_per_group: { type: Number, default: 2 },
      avoid_same_club: { type: Boolean, default: false },
    },

    knockout: {
      consolation: { type: Boolean, default: false },
      draw_size: Number, // null for auto-calculate
    },

    // Scheduling
    courts: { type: Number, default: 1 },
    min_rest_minutes: { type: Number, default: 20 },
    allow_walkovers: { type: Boolean, default: true },

    // Tiebreakers for round robin/pools
    tiebreakers: [
      {
        type: String,
        enum: [
          'wins',
          'h2h',
          'game_diff',
          'point_diff',
          'fewest_walkovers',
          'random',
        ],
      },
    ],
  },

  // Tournament metadata
  start_date: Date,
  end_date: Date,
  venue: String,
  description: String,

  // Format-specific state (opaque blob)
  state_blob: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Audit trail
  created_by: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Update the updated_at field on save
tournamentSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('Tournament', tournamentSchema);
