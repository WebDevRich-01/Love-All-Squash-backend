const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  description: String,
});

module.exports = mongoose.model("Event", eventSchema);
