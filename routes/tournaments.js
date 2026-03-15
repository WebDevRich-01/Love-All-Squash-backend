const { Router } = require('express');
const Tournament = require('../models/Tournament');
const TournamentParticipant = require('../models/TournamentParticipant');
const TournamentMatch = require('../models/TournamentMatch');
const TournamentGroup = require('../models/TournamentGroup');
const validate = require('../middleware/validate');
const requireAdmin = require('../middleware/auth');
const { tournamentSchema, matchResultSchema } = require('../schemas/index');

/**
 * @param {object} tournamentEngine - TournamentEngine instance
 * @param {object} logger - pino logger instance
 */
module.exports = function createTournamentRouter(tournamentEngine, logger) {
  const router = Router();

  // GET /formats
  router.get('/formats', (req, res) => {
    try {
      const formats = tournamentEngine.getAvailableFormats();
      res.json(formats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST / — create tournament
  router.post('/', requireAdmin, validate(tournamentSchema), async (req, res) => {
    try {
      const { name, format, config, participants, start_date, end_date, venue, description } = req.body;

      const validation = tournamentEngine.validateTournament(format, config, participants);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Tournament validation failed', details: validation.errors });
      }

      const tournament = new Tournament({ name, format, config, start_date, end_date, venue, description, status: 'draft' });
      await tournament.save();

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

      const initialState = tournamentEngine.generateTournament(format, config, participantDocs);

      tournament.state_blob = initialState.state;
      tournament.status = 'active';
      await tournament.save();

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
            result: match.result,
          }).save()
        )
      );

      res.status(201).json({ tournament, participants: participantDocs, matches: matchDocs });
    } catch (error) {
      logger.error({ err: error }, 'Error creating tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // GET / — list all
  router.get('/', async (req, res) => {
    try {
      const tournaments = await Tournament.find().sort({ created_at: -1 });
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id — full detail
  router.get('/:id', async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const [participants, matches, groups] = await Promise.all([
        TournamentParticipant.find({ tournament_id: tournament._id }),
        TournamentMatch.find({ tournament_id: tournament._id }).populate('match_id').sort({ round: 1, match_number: 1 }),
        TournamentGroup.find({ tournament_id: tournament._id }),
      ]);

      res.json({ tournament, participants, matches, groups });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id/standings
  router.get('/:id/standings', async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const groups = await TournamentGroup.find({ tournament_id: tournament._id });
      const standings = tournamentEngine.getStandings(tournament.format, tournament.state_blob, groups);
      res.json(standings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id/matches/playable
  router.get('/:id/matches/playable', async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const allMatches = await TournamentMatch.find({ tournament_id: tournament._id });
      const playableMatches = tournamentEngine.getPlayableMatches(tournament.format, tournament.state_blob, allMatches);
      res.json(playableMatches);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:tournamentId/matches/:matchId/result
  router.post(
    '/:tournamentId/matches/:matchId/result',
    requireAdmin,
    validate(matchResultSchema),
    async (req, res) => {
      try {
        const { tournamentId, matchId } = req.params;
        const matchResult = req.body;

        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        const tournamentMatch = await TournamentMatch.findById(matchId);
        if (!tournamentMatch) return res.status(404).json({ error: 'Tournament match not found' });

        const [groups, allMatches] = await Promise.all([
          TournamentGroup.find({ tournament_id: tournamentId }),
          TournamentMatch.find({ tournament_id: tournamentId }),
        ]);

        const result = tournamentEngine.processMatchResult(
          tournament.format,
          tournament.state_blob,
          tournamentMatch.toObject(),
          matchResult,
          groups,
          allMatches.map((m) => m.toObject())
        );

        tournament.state_blob = result.state;
        if (result.tournamentComplete) tournament.status = 'completed';
        await tournament.save();

        if (result.updatedMatches && result.updatedMatches.length > 0) {
          await Promise.all(
            result.updatedMatches.map(({ _id, ...fields }) =>
              TournamentMatch.findByIdAndUpdate(_id, { $set: fields }, { new: true })
            )
          );
        }

        if (result.newMatches && result.newMatches.length > 0) {
          await Promise.all(
            result.newMatches.map((match) =>
              new TournamentMatch({ ...match, tournament_id: tournamentId }).save()
            )
          );
        }

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
          message: result.tournamentComplete ? 'Tournament completed!' : 'Match result processed',
        });
      } catch (error) {
        logger.error({ err: error }, 'Error processing match result');
        res.status(500).json({ error: error.message });
      }
    }
  );

  // DELETE /:id — cascade delete
  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const tournamentId = req.params.id;
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

  return router;
};
