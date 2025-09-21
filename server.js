const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

// Import models
const Match = require("./models/Match");
const Event = require("./models/Event");

const app = express();

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Parse the CORS_ORIGIN environment variable
      const allowedOrigins = (
        process.env.CORS_ORIGIN || "http://localhost:3000"
      )
        .split(",")
        .map((o) => o.trim());

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        // Return the specific matching origin, not the entire list
        return callback(null, origin);
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Could not connect to MongoDB:", err));

// Root route
app.get("/", (req, res) => {
  res.json({ message: "Squash Marker API is running" });
});

// Match routes
app.post("/api/matches", async (req, res) => {
  try {
    const match = new Match(req.body);
    await match.save();
    res.status(201).json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/matches", async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: -1 });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/matches/:id", async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }
    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this DELETE route for matches
app.delete("/api/matches/:id", async (req, res) => {
  try {
    const match = await Match.findByIdAndDelete(req.params.id);
    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }
    res.json({ success: true, message: "Match deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this route to delete all matches
app.delete("/api/matches", async (req, res) => {
  try {
    const result = await Match.deleteMany({});
    res.json({
      success: true,
      message: "All matches deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event routes
app.post("/api/events", async (req, res) => {
  try {
    // Check if event already exists
    const existingEvent = await Event.findOne({ name: req.body.name });
    if (existingEvent) {
      // Return existing event instead of creating duplicate
      return res.status(200).json(existingEvent);
    }

    const event = new Event(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (error) {
    // Handle duplicate key error gracefully
    if (error.code === 11000) {
      // Duplicate key error - find and return existing event
      const existingEvent = await Event.findOne({ name: req.body.name });
      return res.status(200).json(existingEvent);
    }
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const events = await Event.find().sort({ date: -1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this DELETE route for events
app.delete("/api/events/:id", async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json({ success: true, message: "Event deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this route to delete all events
app.delete("/api/events", async (req, res) => {
  try {
    const result = await Event.deleteMany({});
    res.json({
      success: true,
      message: "All events deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test route
app.get("/api/test", (req, res) => {
  res.json({ message: "Backend is working!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something broke!" });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
