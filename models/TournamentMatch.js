const mongoose = require('mongoose');

const tournamentMatchSchema = new mongoose.Schema({
  tournament_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true,
  },

  // Match positioning in tournament
  round: { type: Number, required: true },
  stage: {
    type: String,
    default: 'main',
    enum: ['group', 'main', 'consolation', 'losers', 'plate', 'final'],
  },
  match_number: String, // e.g., "R1M1", "SF1", "F"

  // Participants (can be IDs or qualifiers like "W1", "L3", "PoolA#1")
  participant_a: {
    type: {
      type: String,
      enum: ['participant', 'qualifier', 'bye', 'seed_position'],
      default: 'participant',
    },
    participant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TournamentParticipant',
    },
    qualifier: String, // "W1", "L3", "PoolA#1", etc.
    seed: Number, // For seed_position type - which seed position this represents
    name: String, // Resolved name for display
  },

  participant_b: {
    type: {
      type: String,
      enum: ['participant', 'qualifier', 'bye', 'seed_position'],
      default: 'participant',
    },
    participant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TournamentParticipant',
    },
    qualifier: String,
    seed: Number, // For seed_position type - which seed position this represents
    name: String,
  },

  // Scheduling
  scheduled_at: Date,
  court: String,
  estimated_duration: { type: Number, default: 45 }, // minutes

  // Match status and results
  status: {
    type: String,
    default: 'pending',
    enum: ['pending', 'ready', 'live', 'completed', 'walkover', 'cancelled'],
  },

  // Link to completed match record (reuse existing Match model)
  match_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },

  // Quick result summary (duplicated for query performance)
  result: {
    winner_participant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TournamentParticipant',
    },
    winner_name: String,
    loser_participant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TournamentParticipant',
    },
    loser_name: String,
    game_scores: [{ player1: Number, player2: Number }],
    walkover: { type: Boolean, default: false },
    walkover_reason: String,
    retired: { type: Boolean, default: false },
    retirement_reason: String,
  },

  // Dependencies for bracket progression
  dependency_matches: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentMatch' },
  ],
  feeds_to_matches: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentMatch' },
  ],

  // Group reference (for pools/round robin)
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentGroup' },

  // Audit trail
  created_at: { type: Date, default: Date.now },
  completed_at: Date,
  marker: String, // Who scored this match
});

// Indexes for efficient queries
tournamentMatchSchema.index({ tournament_id: 1, status: 1 });
tournamentMatchSchema.index({ tournament_id: 1, round: 1, stage: 1 });
tournamentMatchSchema.index({ tournament_id: 1, scheduled_at: 1 });
tournamentMatchSchema.index({ tournament_id: 1, group_id: 1 });

module.exports = mongoose.model('TournamentMatch', tournamentMatchSchema);
