# Love All Squash — Backend

Node.js + Express REST API with MongoDB. Handles match persistence and tournament management.

## Commands

```bash
npm run dev    # Start with nodemon (hot reload) on port 3001
npm start      # Start production server
```

## Environment

Copy `.env.example` to `.env` and set:

```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/love-all-squash
PORT=3001
CORS_ORIGIN=https://your-frontend.netlify.app,http://localhost:5173
NODE_ENV=development
```

## Architecture

All routes are defined in `server.js` (single file). MongoDB models are in `models/`. Tournament logic is isolated in `tournament/`.

### Tournament Engine

`tournament/TournamentEngine.js` orchestrates all tournament operations. It uses a plugin pattern — each format implements the interface defined in `ITournamentFormat.js`:

- `generateTournament(config, participants)` — create initial matches and state
- `processMatchResult(state, match, result, groups)` — update bracket after a result
- `getPlayableMatches(state, matches)` — return matches ready to start
- `getStandings(state, groups)` — calculate current standings
- `validateTournament(config, participants)` — validate before creation

**To add a new tournament format:** create a class in `tournament/formats/` implementing `ITournamentFormat`, then register it in `TournamentEngine._registerFormats()`.

### Supported Tournament Formats

| ID | Name |
|----|------|
| `single_elimination` | Single Elimination |
| `round_robin` | Round Robin |
| `monrad` | Monrad (Swiss-style) |
| `pools_knockout` | Pools + Knockout |

### Monrad / Dynamic Bracket Notes
Monrad matches use `seed_position` placeholders for participants not yet determined. After each round's results are submitted, `processMatchResult` resolves these placeholders into real participants. Don't hardcode participant IDs in match documents for Monrad — always go through the engine.

### Tournament State
Tournament state is serialised as a JSON blob (`state_blob`) in the `Tournament` document. The engine reads/writes this blob on every operation. It is the source of truth for bracket progression — don't modify it directly.

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express app, middleware, all API routes |
| `tournament/TournamentEngine.js` | Format orchestration |
| `tournament/ITournamentFormat.js` | Format interface |
| `tournament/formats/` | Individual format implementations |
| `models/Match.js` | Match schema |
| `models/Event.js` | Event schema |
| `models/Tournament.js` | Tournament schema (holds state_blob) |
| `models/TournamentMatch.js` | Individual match within a tournament |
| `models/TournamentParticipant.js` | Tournament participant |
| `models/TournamentGroup.js` | Pool/group with standings |

## API Routes

### Matches
- `POST /api/matches` — save completed match (auto-creates event if named)
- `GET /api/matches` — list all (sorted by date desc)
- `GET /api/matches/:id` — get one
- `DELETE /api/matches/:id` — delete one
- `DELETE /api/matches` — delete all

### Events
- `POST /api/events` — create (returns existing if name already used)
- `GET /api/events` — list all
- `DELETE /api/events/:id` — delete one
- `DELETE /api/events` — delete all

### Tournaments
- `GET /api/tournaments/formats` — list available formats
- `POST /api/tournaments` — create tournament (runs validation + generates initial matches)
- `GET /api/tournaments` — list all
- `GET /api/tournaments/:id` — get full detail (participants, matches, groups)
- `GET /api/tournaments/:id/standings` — current standings
- `GET /api/tournaments/:id/matches/playable` — matches ready to play
- `POST /api/tournaments/:tournamentId/matches/:matchId/result` — submit result (updates bracket)
- `DELETE /api/tournaments/:id` — cascade delete (tournament + all related documents)

### Health
- `GET /` — status
- `GET /api/test` — health check

## Data Notes

- Event names have a unique constraint. The `POST /api/events` route handles duplicate key error (code 11000) gracefully by returning the existing event.
- Deleting a tournament cascades to `TournamentMatch`, `TournamentParticipant`, and `TournamentGroup` documents.
- The backend runs on **CommonJS** (`require`/`module.exports`), not ESM.
