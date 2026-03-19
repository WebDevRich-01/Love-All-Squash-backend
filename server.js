const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
require('dotenv').config();

// Logger — set LOG_LEVEL env var to control verbosity (default 'info')
const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// Import tournament engine
const TournamentEngine = require('./tournament/TournamentEngine');

// Import routes
const matchRoutes = require('./routes/matches');
const eventRoutes = require('./routes/events');
const createTournamentRouter = require('./routes/tournaments');

const app = express();

// Initialize tournament engine
const tournamentEngine = new TournamentEngine();

// Security headers
app.use(helmet());

// HTTP request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(pinoHttp({ logger }));
}

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later.' },
});

if (process.env.NODE_ENV !== 'test') {
  app.use(generalLimiter);
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'DELETE') {
      return writeLimiter(req, res, next);
    }
    next();
  });
}

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Parse the CORS_ORIGIN environment variable
      const allowedOrigins = (
        process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173'
      )
        .split(',')
        .map((o) => o.trim());

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        // Return the specific matching origin, not the entire list
        return callback(null, origin);
      }

      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);
app.use(express.json());

// Connect to MongoDB (skip when tests control the connection)
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => logger.info('Connected to MongoDB'))
    .catch((err) => logger.error({ err }, 'Could not connect to MongoDB'));
}

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Squash Marker API is running' });
});

// API routes
app.use('/api/matches', matchRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/tournaments', createTournamentRouter(tournamentEngine, logger));

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Something broke!' });
});

// Start server (skip when required by tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

module.exports = app;
