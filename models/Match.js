const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  player1Name: { type: String, required: true },
  player2Name: { type: String, required: true },
  player1Color: String,
  player2Color: String,
  gameScores: [
    {
      player1: Number,
      player2: Number,
    },
  ],
  matchSettings: {
    pointsToWin: { type: Number, required: true },
    clearPoints: { type: Number, required: true },
    bestOf: { type: Number, required: true },
    player1Serving: Boolean,
  },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  eventName: String,
});

module.exports = mongoose.model("Match", matchSchema);
