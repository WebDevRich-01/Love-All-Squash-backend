# Love All Squash - Backend

RESTful API backend for the Love All Squash application, providing match data, event management, and full tournament support.

## Features

- RESTful API for match, event, and tournament management
- MongoDB database integration
- Tournament engine supporting 4 formats (Single Elimination, Round Robin, Monrad, Pools + Knockout)
- CORS configuration for multiple origins
- Environment-based configuration
- Match history with comprehensive scoring data
- Event management and tracking

## Tech Stack

- Node.js
- Express.js
- MongoDB with Mongoose
- CORS support
- dotenv for environment management

## Development Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your configuration:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/love-all-squash
   PORT=3001
   CORS_ORIGIN=https://your-frontend-url.netlify.app,http://localhost:3000,http://localhost:5173
   NODE_ENV=development
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Matches
- `GET /api/matches` - Get all matches
- `GET /api/matches/:id` - Get specific match
- `POST /api/matches` - Create new match
- `DELETE /api/matches/:id` - Delete specific match
- `DELETE /api/matches` - Delete all matches

### Events
- `GET /api/events` - Get all events
- `POST /api/events` - Create new event
- `DELETE /api/events/:id` - Delete specific event
- `DELETE /api/events` - Delete all events

### Tournaments
- `GET /api/tournaments/formats` - List available tournament formats
- `GET /api/tournaments` - Get all tournaments
- `POST /api/tournaments` - Create new tournament
- `GET /api/tournaments/:id` - Get tournament with participants, matches, and groups
- `GET /api/tournaments/:id/standings` - Get current tournament standings
- `GET /api/tournaments/:id/matches/playable` - Get matches ready to play
- `POST /api/tournaments/:tournamentId/matches/:matchId/result` - Submit a match result
- `DELETE /api/tournaments/:id` - Delete tournament and all related data

### Health Check
- `GET /` - API status
- `GET /api/test` - Backend health check

## Database Setup

1. Create a MongoDB Atlas account or set up local MongoDB
2. Create a new database called `love-all-squash`
3. Update the `MONGODB_URI` in your `.env` file
4. The application will automatically create the required collections

## Deployment

### Render Deployment

1. Connect this repository to Render
2. Use the provided `render.yaml` configuration
3. Set environment variables in Render dashboard:
   - `MONGODB_URI`: Your MongoDB connection string
   - `CORS_ORIGIN`: Your frontend URL(s)
   - `NODE_ENV`: `production`

### Manual Deployment

1. Build and start:
   ```bash
   npm install
   npm start
   ```

## Environment Variables

- `MONGODB_URI`: MongoDB connection string
- `PORT`: Server port (default: 3001)
- `CORS_ORIGIN`: Comma-separated list of allowed origins
- `NODE_ENV`: Environment (development/production)

## Project Structure

```
├── server.js               # Express app and all API routes
├── models/
│   ├── Match.js            # Match schema
│   ├── Event.js            # Event schema
│   ├── Tournament.js       # Tournament schema
│   ├── TournamentMatch.js  # Individual tournament match schema
│   ├── TournamentParticipant.js
│   └── TournamentGroup.js  # Pool/group schema
└── tournament/
    ├── TournamentEngine.js # Orchestrates tournament logic
    ├── ITournamentFormat.js # Format interface/contract
    └── formats/            # Individual format implementations
```

## Data Models

### Match
- Player names and colors
- Game scores and points
- Match settings (first to, let decisions)
- Event association
- Timestamps

### Event
- Event name
- Creation date
- Associated matches

### Tournament
- Name, format, description, venue
- Status (draft, active, completed)
- Start/end dates
- Serialised tournament engine state

### TournamentMatch
- Round and stage metadata
- Participant references (or seed position placeholders for Monrad)
- Status (pending, ready, in_progress, completed)
- Result with winner/loser details

### TournamentParticipant
- Name, seed number, club, colour

### TournamentGroup
- Group name and participants
- Standings array

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests (placeholder)
