const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    description: String,
  },
  { collation: { locale: 'en', strength: 2 } } // case-insensitive unique index on name
);

module.exports = mongoose.model("Event", eventSchema);
