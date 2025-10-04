const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import models
const Match = require('./models/Match');
const Event = require('./models/Event');
const Tournament = require('./models/Tournament');
const TournamentParticipant = require('./models/TournamentParticipant');
const TournamentMatch = require('./models/TournamentMatch');
const TournamentGroup = require('./models/TournamentGroup');

// Import tournament engine
const TournamentEngine = require('./tournament/TournamentEngine');

const app = express();

// Initialize tournament engine
const tournamentEngine = new TournamentEngine();

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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('Could not connect to MongoDB:', err));

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Squash Marker API is running' });
});

// Match routes
app.post('/api/matches', async (req, res) => {
  try {
    const match = new Match(req.body);
    await match.save();
    res.status(201).json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/matches', async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: -1 });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this DELETE route for matches
app.delete('/api/matches/:id', async (req, res) => {
  try {
    const match = await Match.findByIdAndDelete(req.params.id);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    res.json({ success: true, message: 'Match deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this route to delete all matches
app.delete('/api/matches', async (req, res) => {
  try {
    const result = await Match.deleteMany({});
    res.json({
      success: true,
      message: 'All matches deleted successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event routes
app.post('/api/events', async (req, res) => {
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

app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find().sort({ date: -1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this DELETE route for events
app.delete('/api/events/:id', async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this route to delete all events
app.delete('/api/events', async (req, res) => {
  try {
    const result = await Event.deleteMany({});
    res.json({
      success: true,
      message: 'All events deleted successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tournament routes

// Get available tournament formats
app.get('/api/tournaments/formats', (req, res) => {
  try {
    const formats = tournamentEngine.getAvailableFormats();
    res.json(formats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new tournament
app.post('/api/tournaments', async (req, res) => {
  try {
    const {
      name,
      format,
      config,
      participants,
      start_date,
      end_date,
      venue,
      description,
    } = req.body;

    // Validate tournament configuration
    const validation = tournamentEngine.validateTournament(
      format,
      config,
      participants
    );
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Tournament validation failed',
        details: validation.errors,
      });
    }

    // Create tournament document
    const tournament = new Tournament({
      name,
      format,
      config,
      start_date,
      end_date,
      venue,
      description,
      status: 'draft',
    });
    await tournament.save();

    // Create participants
    const participantDocs = await Promise.all(
      participants.map((p) =>
        new TournamentParticipant({
          tournament_id: tournament._id,
          name: p.name,
          seed: p.seed,
          club: p.club,
          color: p.color || 'border-blue-500',
        }).save()
      )
    );

    // Generate initial tournament state
    const initialState = tournamentEngine.generateTournament(
      format,
      config,
      participantDocs
    );

    // Update tournament with state
    tournament.state_blob = initialState.state;
    tournament.status = 'active';
    await tournament.save();

    // Create tournament groups if needed
    if (initialState.groups && initialState.groups.length > 0) {
      await Promise.all(
        initialState.groups.map((group) =>
          new TournamentGroup({
            tournament_id: tournament._id,
            name: group.name,
            participant_ids: group.participants.map((p) => p._id),
          }).save()
        )
      );
    }

    // Create tournament matches
    const matchDocs = await Promise.all(
      initialState.matches.map((match) =>
        new TournamentMatch({
          tournament_id: tournament._id,
          round: match.round,
          stage: match.stage,
          match_number: match.match_number,
          participant_a: match.participant_a,
          participant_b: match.participant_b,
          status: match.status,
          group_id: match.group_id,
        }).save()
      )
    );

    res.status(201).json({
      tournament,
      participants: participantDocs,
      matches: matchDocs,
    });
  } catch (error) {
    console.error('Error creating tournament:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all tournaments
app.get('/api/tournaments', async (req, res) => {
  try {
    const tournaments = await Tournament.find().sort({ created_at: -1 });
    res.json(tournaments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific tournament with full details
app.get('/api/tournaments/:id', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const participants = await TournamentParticipant.find({
      tournament_id: tournament._id,
    });
    const matches = await TournamentMatch.find({
      tournament_id: tournament._id,
    })
      .populate('match_id')
      .sort({ round: 1, match_number: 1 });
    const groups = await TournamentGroup.find({
      tournament_id: tournament._id,
    });

    res.json({
      tournament,
      participants,
      matches,
      groups,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tournament standings
app.get('/api/tournaments/:id/standings', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const groups = await TournamentGroup.find({
      tournament_id: tournament._id,
    });
    const standings = tournamentEngine.getStandings(
      tournament.format,
      tournament.state_blob,
      groups
    );

    res.json(standings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get playable matches for a tournament
app.get('/api/tournaments/:id/matches/playable', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const allMatches = await TournamentMatch.find({
      tournament_id: tournament._id,
    });
    const playableMatches = tournamentEngine.getPlayableMatches(
      tournament.format,
      tournament.state_blob,
      allMatches
    );

    res.json(playableMatches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit tournament match result
app.post(
  '/api/tournaments/:tournamentId/matches/:matchId/result',
  async (req, res) => {
    console.log('=== TOURNAMENT MATCH RESULT API CALLED ===');
    console.log('Tournament ID:', req.params.tournamentId);
    console.log('Match ID:', req.params.matchId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    try {
      const { tournamentId, matchId } = req.params;
      const matchResult = req.body;

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }

      const tournamentMatch = await TournamentMatch.findById(matchId);
      if (!tournamentMatch) {
        return res.status(404).json({ error: 'Tournament match not found' });
      }

      // Process the match result through tournament engine
      const groups = await TournamentGroup.find({
        tournament_id: tournamentId,
      });
      const result = tournamentEngine.processMatchResult(
        tournament.format,
        tournament.state_blob,
        tournamentMatch,
        matchResult,
        groups
      );

      // Update tournament state
      tournament.state_blob = result.state;
      if (result.tournamentComplete) {
        tournament.status = 'completed';
      }
      await tournament.save();

      // Update existing matches
      if (result.updatedMatches && result.updatedMatches.length > 0) {
        console.log(
          `Updating ${result.updatedMatches.length} existing matches:`
        );
        result.updatedMatches.forEach((match, index) => {
          console.log(
            `  Match ${index + 1}: ${match.match_number} - Status: ${
              match.status
            }, Has result: ${!!match.result}, ID: ${match._id}`
          );
        });

        const updateResults = await Promise.all(
          result.updatedMatches.map(async (match) => {
            console.log(
              `Updating match ${match._id} to status: ${match.status}`
            );
            const updateResult = await TournamentMatch.findByIdAndUpdate(
              match._id,
              match,
              { new: true }
            );
            console.log(
              `Update result for ${match._id}: Status now ${
                updateResult?.status
              }, Has result: ${!!updateResult?.result}`
            );
            return updateResult;
          })
        );
        console.log(
          `Successfully updated ${result.updatedMatches.length} matches`
        );
      } else {
        console.log('No existing matches to update');
      }

      // For Monrad tournaments, resolve placeholder matches in next round
      // This happens AFTER the current match is marked as completed
      if (tournament.format === 'monrad') {
        const nextRound = tournamentMatch.round + 1;
        if (nextRound <= result.state.totalRounds) {
          console.log(`Resolving placeholder matches in round ${nextRound}`);

          // Find matches in next round with seed_position placeholders
          const nextRoundMatches = await TournamentMatch.find({
            tournament_id: tournamentId,
            round: nextRound,
            $or: [
              { 'participant_a.type': 'seed_position' },
              { 'participant_b.type': 'seed_position' },
            ],
          });

          console.log(
            `Found ${nextRoundMatches.length} matches with placeholders in round ${nextRound}`
          );

          // Update matches where both participants are now determined
          // First, get all completed matches from the current round to determine which participants are available

          // Add a longer delay to ensure database consistency
          console.log('Waiting for database consistency...');
          await new Promise((resolve) => setTimeout(resolve, 500));

          const completedCurrentRoundMatches = await TournamentMatch.find({
            tournament_id: tournamentId,
            round: tournamentMatch.round,
            status: 'completed',
          });

          // Also query all matches in the current round to see their statuses
          const allCurrentRoundMatches = await TournamentMatch.find({
            tournament_id: tournamentId,
            round: tournamentMatch.round,
          });

          console.log(
            `Total matches in round ${tournamentMatch.round}:`,
            await TournamentMatch.countDocuments({
              tournament_id: tournamentId,
              round: tournamentMatch.round,
            })
          );
          console.log(
            `Completed matches in round ${tournamentMatch.round}:`,
            completedCurrentRoundMatches.length
          );

          // Debug all matches in current round
          console.log('All matches in current round:');
          allCurrentRoundMatches.forEach((match, index) => {
            console.log(
              `  Match ${index + 1}: ${match.match_number}, Status: ${
                match.status
              }, Has result: ${!!match.result}`
            );
          });

          // Debug: Let's see what the completed matches look like
          console.log('Completed matches details:');
          completedCurrentRoundMatches.forEach((match, index) => {
            console.log(
              `  Completed match ${index + 1}: ${match.match_number}, Status: ${
                match.status
              }, Winner: ${match.result?.winner_id}, Loser: ${
                match.result?.loser_id
              }`
            );
          });

          // Extract participant IDs from completed matches (winners and losers)
          const availableParticipantIds = new Set();
          completedCurrentRoundMatches.forEach((match) => {
            console.log(`Processing completed match ${match.match_number}:`, {
              winner: match.result?.winner_participant_id,
              loser: match.result?.loser_participant_id,
            });
            if (match.result?.winner_participant_id) {
              availableParticipantIds.add(
                match.result.winner_participant_id.toString()
              );
            }
            if (match.result?.loser_participant_id) {
              availableParticipantIds.add(
                match.result.loser_participant_id.toString()
              );
            }
          });

          console.log(
            `Available participants from completed matches:`,
            Array.from(availableParticipantIds)
          );

          for (const match of nextRoundMatches) {
            let updated = false;
            const matchUpdate = { ...match.toObject() };

            console.log(`Processing match ${match.match_number}:`);
            console.log(
              `  participant_a: ${match.participant_a?.type}, seed: ${match.participant_a?.seed}`
            );
            console.log(
              `  participant_b: ${match.participant_b?.type}, seed: ${match.participant_b?.seed}`
            );
            console.log(
              `  Current seed positions:`,
              result.state.seedPositions
            );

            // Resolve participant_a if it's a placeholder and the participant is available
            if (matchUpdate.participant_a.type === 'seed_position') {
              const seedPosition = matchUpdate.participant_a.seed;
              console.log(
                `Looking for seed position ${seedPosition} in seedPositions`
              );

              const seedInfo = result.state.seedPositions[seedPosition];
              console.log(
                `Found participant info for seed ${seedPosition}:`,
                seedInfo
              );

              if (
                seedInfo &&
                seedInfo.participant_id &&
                availableParticipantIds.has(seedInfo.participant_id.toString())
              ) {
                matchUpdate.participant_a = {
                  type: 'participant',
                  participant_id: seedInfo.participant_id,
                  name: seedInfo.name,
                };
                updated = true;
                console.log(
                  `Resolved participant_a seed ${seedPosition} to ${seedInfo.name}`
                );
              }
            }

            // Resolve participant_b if it's a placeholder and the participant is available
            if (matchUpdate.participant_b.type === 'seed_position') {
              const seedPosition = matchUpdate.participant_b.seed;
              console.log(
                `Looking for seed position ${seedPosition} in seedPositions`
              );

              const seedInfo = result.state.seedPositions[seedPosition];
              console.log(
                `Found participant info for seed ${seedPosition}:`,
                seedInfo
              );

              if (
                seedInfo &&
                seedInfo.participant_id &&
                availableParticipantIds.has(seedInfo.participant_id.toString())
              ) {
                matchUpdate.participant_b = {
                  type: 'participant',
                  participant_id: seedInfo.participant_id,
                  name: seedInfo.name,
                };
                updated = true;
                console.log(
                  `Resolved participant_b seed ${seedPosition} to ${seedInfo.name}`
                );
              }
            }

            // If both participants are now determined, make the match ready
            if (
              matchUpdate.participant_a.type === 'participant' &&
              matchUpdate.participant_b.type === 'participant' &&
              match.status === 'pending'
            ) {
              matchUpdate.status = 'ready';
              updated = true;
              console.log(`Match ${match.match_number} is now ready to play`);
            }

            // Update the match if changes were made
            if (updated) {
              await TournamentMatch.findByIdAndUpdate(match._id, matchUpdate);
            }
          }
        }
      }

      // Create new matches
      if (result.newMatches && result.newMatches.length > 0) {
        console.log(
          `Creating ${result.newMatches.length} new matches for tournament ${tournamentId}`
        );
        await Promise.all(
          result.newMatches.map((match) =>
            new TournamentMatch({
              ...match,
              tournament_id: tournamentId,
            }).save()
          )
        );
        console.log(
          `Successfully created ${result.newMatches.length} new matches`
        );
      } else {
        console.log('No new matches to create');
      }

      // Update group standings
      if (result.standingsUpdates && result.standingsUpdates.length > 0) {
        await Promise.all(
          result.standingsUpdates.map((update) =>
            TournamentGroup.findByIdAndUpdate(update.group_id, {
              standings: update.standings,
              updated_at: new Date(),
            })
          )
        );
      }

      res.json({
        success: true,
        tournament_complete: result.tournamentComplete,
        message: result.tournamentComplete
          ? 'Tournament completed!'
          : 'Match result processed',
      });
    } catch (error) {
      console.error('Error processing match result:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete a tournament
app.delete('/api/tournaments/:id', async (req, res) => {
  try {
    const tournamentId = req.params.id;

    // Delete all related data
    await Promise.all([
      TournamentMatch.deleteMany({ tournament_id: tournamentId }),
      TournamentParticipant.deleteMany({ tournament_id: tournamentId }),
      TournamentGroup.deleteMany({ tournament_id: tournamentId }),
      Tournament.findByIdAndDelete(tournamentId),
    ]);

    res.json({ success: true, message: 'Tournament deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
