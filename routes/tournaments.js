const { Router } = require('express');
const bcrypt = require('bcryptjs');
const Tournament = require('../models/Tournament');
const TournamentParticipant = require('../models/TournamentParticipant');
const TournamentMatch = require('../models/TournamentMatch');
const TournamentGroup = require('../models/TournamentGroup');
const validate = require('../middleware/validate');
const requireAdmin = require('../middleware/auth');
const {
  tournamentSchema,
  verifyPassphraseSchema,
  startTournamentSchema,
  tournamentUpdateSchema,
  participantUpdateSchema,
  matchResultSchema,
} = require('../schemas/index');

// Helper: verify passphrase against tournament's stored hash
async function checkPassphrase(tournament, passphrase) {
  if (!tournament.passphrase) return false;
  return bcrypt.compare(passphrase, tournament.passphrase);
}

// Helper: create match documents from engine output
async function createMatchDocs(matches, tournamentId) {
  return Promise.all(
    matches.map((match) =>
      new TournamentMatch({
        tournament_id: tournamentId,
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
}

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

  // POST / — create tournament (saves as draft, no matches generated yet)
  router.post('/', validate(tournamentSchema), async (req, res) => {
    try {
      const { name, format, config, participants, start_date, end_date, venue, description, passphrase } = req.body;

      const passphraseHash = await bcrypt.hash(passphrase, 10);

      const tournament = new Tournament({
        name, format, config, start_date, end_date, venue, description,
        passphrase: passphraseHash,
        status: 'draft',
      });
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

      res.status(201).json({ tournament, participants: participantDocs, matches: [] });
    } catch (error) {
      logger.error({ err: error }, 'Error creating tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/verify-passphrase — check passphrase without performing an action
  router.post('/:id/verify-passphrase', validate(verifyPassphraseSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      res.json({ valid: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/start — generate matches and move draft → active
  router.post('/:id/start', validate(startTournamentSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.status !== 'draft') return res.status(400).json({ error: 'Tournament has already been started' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      const participants = await TournamentParticipant.find({ tournament_id: tournament._id });

      const validation = tournamentEngine.validateTournament(tournament.format, tournament.config, participants);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Tournament validation failed', details: validation.errors });
      }

      const initialState = tournamentEngine.generateTournament(tournament.format, tournament.config, participants);

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

      const matchDocs = await createMatchDocs(initialState.matches, tournament._id);

      res.json({ tournament, participants, matches: matchDocs });
    } catch (error) {
      logger.error({ err: error }, 'Error starting tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/reset — clear all results and return to draft so the organiser can edit before restarting
  router.post('/:id/reset', validate(startTournamentSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.status === 'draft') return res.status(400).json({ error: 'Tournament has not been started yet' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      // Wipe all match and group data
      await TournamentMatch.deleteMany({ tournament_id: tournament._id });
      await TournamentGroup.deleteMany({ tournament_id: tournament._id });

      // Return to draft — organiser can edit players/settings then click Start again
      tournament.state_blob = undefined;
      tournament.status = 'draft';
      await tournament.save();

      const participants = await TournamentParticipant.find({ tournament_id: tournament._id });

      res.json({ tournament, participants, matches: [] });
    } catch (error) {
      logger.error({ err: error }, 'Error resetting tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /:id — update tournament details
  //   Draft: all fields + full participant replacement
  //   Active: metadata only (name, dates, venue, description)
  router.patch('/:id', validate(tournamentUpdateSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      const { name, format, config, start_date, end_date, venue, description, participants } = req.body;

      // Fields editable in both states
      if (name !== undefined) tournament.name = name;
      if (start_date !== undefined) tournament.start_date = start_date || undefined;
      if (end_date !== undefined) tournament.end_date = end_date || undefined;
      if (venue !== undefined) tournament.venue = venue || undefined;
      if (description !== undefined) tournament.description = description || undefined;

      if (tournament.status === 'draft') {
        if (format !== undefined) tournament.format = format;
        if (config !== undefined) {
          // Update config sub-paths directly to avoid clobbering Mongoose schema defaults
          // on sibling fields (groups, knockout) that were never explicitly set
          if (config.match !== undefined) tournament.set('config.match', config.match);
          if (config.courts !== undefined) tournament.set('config.courts', config.courts);
          if (config.min_rest_minutes !== undefined) tournament.set('config.min_rest_minutes', config.min_rest_minutes);
          if (config.allow_walkovers !== undefined) tournament.set('config.allow_walkovers', config.allow_walkovers);
        }

        // Replace participants if provided
        if (participants && participants.length > 0) {
          await TournamentParticipant.deleteMany({ tournament_id: tournament._id });
          await Promise.all(
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
        }
      }

      await tournament.save();

      const updatedParticipants = await TournamentParticipant.find({ tournament_id: tournament._id });
      res.json({ tournament, participants: updatedParticipants });
    } catch (error) {
      logger.error({ err: error }, 'Error updating tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /:id/participants/:participantId — rename a participant (substitutions)
  router.patch('/:id/participants/:participantId', validate(participantUpdateSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      const participant = await TournamentParticipant.findOneAndUpdate(
        { _id: req.params.participantId, tournament_id: tournament._id },
        { name: req.body.name },
        { new: true }
      );
      if (!participant) return res.status(404).json({ error: 'Participant not found' });

      // Also update name in state_blob (Monrad keeps names there)
      if (tournament.state_blob && tournament.state_blob.players) {
        const players = tournament.state_blob.players.map((p) =>
          p.id === req.params.participantId ? { ...p, name: req.body.name } : p
        );
        tournament.state_blob = { ...tournament.state_blob, players };
        tournament.markModified('state_blob');
        await tournament.save();
      }

      // Update any match documents that reference this participant's name
      await Promise.all([
        TournamentMatch.updateMany(
          { tournament_id: tournament._id, 'participant_a.participant_id': participant._id },
          { $set: { 'participant_a.name': req.body.name } }
        ),
        TournamentMatch.updateMany(
          { tournament_id: tournament._id, 'participant_b.participant_id': participant._id },
          { $set: { 'participant_b.name': req.body.name } }
        ),
      ]);

      res.json({ participant });
    } catch (error) {
      logger.error({ err: error }, 'Error updating participant');
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
