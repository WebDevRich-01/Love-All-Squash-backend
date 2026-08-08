const { Router } = require('express');
const bcrypt = require('bcryptjs');
const Tournament = require('../models/Tournament');
const TournamentParticipant = require('../models/TournamentParticipant');
const TournamentMatch = require('../models/TournamentMatch');
const TournamentGroup = require('../models/TournamentGroup');
const validate = require('../middleware/validate');
const requireAdmin = require('../middleware/auth');
const { TEAM_FORMATS, deriveTournamentType } = require('../tournament/formatMeta');
const {
  tournamentSchema,
  verifyPassphraseSchema,
  startTournamentSchema,
  tournamentUpdateSchema,
  participantUpdateSchema,
  rosterUpdateSchema,
  matchResultSchema,
  teamFixtureResultSchema,
} = require('../schemas/index');

// Helper: verify passphrase against tournament's stored hash
async function checkPassphrase(tournament, passphrase) {
  if (!tournament.passphrase) return false;
  return bcrypt.compare(passphrase, tournament.passphrase);
}

// Helper: create match documents from engine output
async function createMatchDocs(matches, tournamentId, fixtureDates = {}) {
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
        scheduled_at: match.match_number && fixtureDates[match.match_number]
          ? new Date(fixtureDates[match.match_number])
          : undefined,
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
      const tournament_type = deriveTournamentType(format);

      const tournament = new Tournament({
        name, format, config, start_date, end_date, venue, description,
        passphrase: passphraseHash,
        tournament_type,
        status: 'draft',
      });
      await tournament.save();

      const participantDocs = await Promise.all(
        participants.map((p) => {
          const doc = new TournamentParticipant({
            tournament_id: tournament._id,
            name: p.name,
            seed: p.seed,
            club: p.club,
            color: p.color || 'border-blue-500',
            roster: p.roster || [],
            division_index: p.division_index,
            is_pool: p.is_pool || p.player_type === 'pool' || false,
          });
          if (p.player_type) doc.player_type = p.player_type;
          return doc.save();
        })
      );

      res.status(201).json({ tournament, participants: participantDocs, matches: [] });
    } catch (error) {
      logger.error({ err: error }, 'Error creating tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/verify-passphrase
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

      // For team formats, only pass actual team participants to the engine;
      // pool/racketball/beginner players are tournament metadata, not match participants.
      const engineParticipants = TEAM_FORMATS.has(tournament.format)
        ? participants.filter((p) => !p.is_pool && !p.player_type)
        : participants;

      const validation = tournamentEngine.validateTournament(tournament.format, tournament.config, engineParticipants);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Tournament validation failed', details: validation.errors });
      }

      const initialState = tournamentEngine.generateTournament(tournament.format, tournament.config, engineParticipants);

      tournament.state_blob = initialState.state;
      tournament.status = 'active';
      await tournament.save();

      // Save groups and capture the real MongoDB ObjectIds
      let groupIdMap = {}; // format string ID → real ObjectId
      if (initialState.groups && initialState.groups.length > 0) {
        const savedGroups = await Promise.all(
          initialState.groups.map((group) =>
            new TournamentGroup({
              tournament_id: tournament._id,
              name: group.name,
              participant_ids: group.participants.map((p) => p._id),
            }).save()
          )
        );

        // Map format string IDs to real ObjectIds for use in match docs
        initialState.groups.forEach((g, i) => {
          groupIdMap[g._id] = savedGroups[i]._id;
        });

        // Initialise standings with team names (so they appear before any match is played)
        await Promise.all(
          initialState.groups.map((formatGroup, i) => {
            const standings = formatGroup.participants.map((p) => ({
              participant_id: p._id,
              name: p.name,
              position: 0,
              played: 0,
              wins: 0,
              losses: 0,
              draws: 0,
              league_points: 0,
              games_won: 0,
              games_lost: 0,
            }));
            return TournamentGroup.findByIdAndUpdate(savedGroups[i]._id, { standings });
          })
        );
      }

      // Resolve string group IDs → real ObjectIds in match documents
      const resolvedMatches = initialState.matches.map((m) => ({
        ...m,
        group_id: m.group_id && groupIdMap[m.group_id] ? groupIdMap[m.group_id] : m.group_id,
      }));

      const fixtureDates = tournament.config?.fixture_dates || {};
      const matchDocs = await createMatchDocs(resolvedMatches, tournament._id, fixtureDates);

      res.json({ tournament, participants, matches: matchDocs });
    } catch (error) {
      logger.error({ err: error }, 'Error starting tournament');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/reset — clear all results and return to draft
  router.post('/:id/reset', validate(startTournamentSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.status === 'draft') return res.status(400).json({ error: 'Tournament has not been started yet' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      await TournamentMatch.deleteMany({ tournament_id: tournament._id });
      await TournamentGroup.deleteMany({ tournament_id: tournament._id });

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
  router.patch('/:id', validate(tournamentUpdateSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const valid = await checkPassphrase(tournament, req.body.passphrase);
      if (!valid) return res.status(401).json({ error: 'Invalid passphrase' });

      const { name, format, config, start_date, end_date, venue, description, participants } = req.body;

      if (name !== undefined) tournament.name = name;
      if (start_date !== undefined) tournament.start_date = start_date || undefined;
      if (end_date !== undefined) tournament.end_date = end_date || undefined;
      if (venue !== undefined) tournament.venue = venue || undefined;
      if (description !== undefined) tournament.description = description || undefined;

      if (tournament.status === 'draft') {
        if (format !== undefined) {
          tournament.format = format;
          tournament.tournament_type = deriveTournamentType(format);
        }
        if (config !== undefined) {
          if (config.match !== undefined) tournament.set('config.match', config.match);
          if (config.courts !== undefined) tournament.set('config.courts', config.courts);
          if (config.min_rest_minutes !== undefined) tournament.set('config.min_rest_minutes', config.min_rest_minutes);
          if (config.allow_walkovers !== undefined) tournament.set('config.allow_walkovers', config.allow_walkovers);
          if (config.divisions !== undefined) tournament.set('config.divisions', config.divisions);
          if (config.fixture_dates !== undefined) {
            tournament.set('config.fixture_dates', config.fixture_dates);
            tournament.markModified('config.fixture_dates');
          }
        }

        if (participants && participants.length > 0) {
          await TournamentParticipant.deleteMany({ tournament_id: tournament._id });
          await Promise.all(
            participants.map((p) => {
              const doc = new TournamentParticipant({
                tournament_id: tournament._id,
                name: p.name,
                seed: p.seed,
                club: p.club,
                color: p.color || 'border-blue-500',
                roster: p.roster || [],
                division_index: p.division_index,
                is_pool: p.is_pool || p.player_type === 'pool' || false,
              });
              if (p.player_type) doc.player_type = p.player_type;
              return doc.save();
            })
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

  // PATCH /:id/participants/:participantId — rename a participant / team
  router.patch('/:id/participants/:participantId', validate(participantUpdateSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const participant = await TournamentParticipant.findOneAndUpdate(
        { _id: req.params.participantId, tournament_id: tournament._id },
        { name: req.body.name },
        { new: true }
      );
      if (!participant) return res.status(404).json({ error: 'Participant not found' });

      if (tournament.state_blob && tournament.state_blob.players) {
        const players = tournament.state_blob.players.map((p) =>
          p.id === req.params.participantId ? { ...p, name: req.body.name } : p
        );
        tournament.state_blob = { ...tournament.state_blob, players };
        tournament.markModified('state_blob');
        await tournament.save();
      }

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

  // PATCH /:id/participants/:participantId/roster — update team roster
  router.patch('/:id/participants/:participantId/roster', validate(rosterUpdateSchema), async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.tournament_type !== 'team') {
        return res.status(400).json({ error: 'Roster management only applies to team tournaments' });
      }

      const participant = await TournamentParticipant.findOneAndUpdate(
        { _id: req.params.participantId, tournament_id: tournament._id },
        { roster: req.body.roster },
        { new: true }
      );
      if (!participant) return res.status(404).json({ error: 'Team not found' });

      res.json({ participant });
    } catch (error) {
      logger.error({ err: error }, 'Error updating roster');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/participants — add a single participant (pool player)
  router.post('/:id/participants', async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const { name, seed, is_pool, player_type } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name is required' });
      }

      const participantData = {
        tournament_id: tournament._id,
        name: name.trim(),
        seed,
        is_pool: is_pool || player_type === 'pool' || false,
        color: 'border-blue-500',
        roster: [],
      };
      if (player_type) participantData.player_type = player_type;

      const participant = await new TournamentParticipant(participantData).save();

      res.status(201).json({ participant });
    } catch (error) {
      logger.error({ err: error }, 'Error adding participant');
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
        TournamentGroup.find({ tournament_id: tournament._id }).sort({ name: 1 }),
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

      const groups = await TournamentGroup.find({ tournament_id: tournament._id }).sort({ name: 1 });
      const standings = tournamentEngine.getStandings(tournament.format, tournament.state_blob, groups);
      res.json(standings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id/final-results
  router.get('/:id/final-results', async (req, res) => {
    try {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

      const groups = await TournamentGroup.find({ tournament_id: tournament._id }).sort({ name: 1 });
      const finalResults = tournamentEngine.getFinalResults(tournament.format, tournament.state_blob, groups);
      res.json(finalResults);
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

  // PATCH /:tournamentId/matches/:matchId/schedule — set or clear scheduled_at
  router.patch('/:tournamentId/matches/:matchId/schedule', requireAdmin, async (req, res) => {
    try {
      const { tournamentId, matchId } = req.params;
      const { scheduled_at } = req.body;

      const match = await TournamentMatch.findOne({ _id: matchId, tournament_id: tournamentId });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      match.scheduled_at = scheduled_at ? new Date(scheduled_at) : undefined;
      await match.save();

      res.json({ success: true, scheduled_at: match.scheduled_at });
    } catch (error) {
      logger.error({ err: error }, 'Error updating fixture schedule');
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /:tournamentId/matches/:matchId/strings — persist in-progress string scores
  // Saves draft results without touching standings or fixture status.
  router.patch('/:tournamentId/matches/:matchId/strings', requireAdmin, async (req, res) => {
    try {
      const { tournamentId, matchId } = req.params;
      const { strings } = req.body;

      if (!Array.isArray(strings)) {
        return res.status(400).json({ error: 'strings must be an array' });
      }

      const match = await TournamentMatch.findOne({ _id: matchId, tournament_id: tournamentId });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      match.draft_string_results = strings;
      await match.save();

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, 'Error saving draft strings');
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /:tournamentId/matches/:matchId/extra-result — save racketball or beginner result (no auth)
  router.patch('/:tournamentId/matches/:matchId/extra-result', async (req, res) => {
    try {
      const { tournamentId, matchId } = req.params;
      const { match_type, team_a_games, team_b_games, game_scores } = req.body;

      if (match_type !== 'racketball' && match_type !== 'beginner') {
        return res.status(400).json({ error: 'match_type must be "racketball" or "beginner"' });
      }

      const match = await TournamentMatch.findOne({ _id: matchId, tournament_id: tournamentId });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      const field = `${match_type}_result`;
      match[field] = { team_a_games, team_b_games, game_scores: game_scores || [] };
      match.markModified(field);
      await match.save();

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, 'Error saving extra match result');
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /:tournamentId/matches/:matchId/extra-player/:type — cancel a racketball/beginner match
  router.delete('/:tournamentId/matches/:matchId/extra-player/:type', async (req, res) => {
    try {
      const { tournamentId, matchId, type } = req.params;

      if (type !== 'racketball' && type !== 'beginner') {
        return res.status(400).json({ error: 'type must be "racketball" or "beginner"' });
      }

      const match = await TournamentMatch.findOne({ _id: matchId, tournament_id: tournamentId });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      if (match[`${type}_result`]?.team_a_games != null) {
        return res.status(409).json({ error: 'Cannot remove a match that already has a result' });
      }

      match[`team_a_${type}_player`] = null;
      match[`team_b_${type}_player`] = null;
      match.markModified(`team_a_${type}_player`);
      match.markModified(`team_b_${type}_player`);
      await match.save();

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, 'Error removing extra match player');
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /:tournamentId/matches/:matchId/lineup — save confirmed team lineup (no auth required)
  router.patch('/:tournamentId/matches/:matchId/lineup', async (req, res) => {
    try {
      const { tournamentId, matchId } = req.params;
      const { side, lineup } = req.body;

      if (side !== 'a' && side !== 'b') {
        return res.status(400).json({ error: 'side must be "a" or "b"' });
      }
      if (!Array.isArray(lineup)) {
        return res.status(400).json({ error: 'lineup must be an array' });
      }

      const match = await TournamentMatch.findOne({ _id: matchId, tournament_id: tournamentId });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      if (side === 'a') {
        match.team_a_lineup = lineup;
        match.team_a_confirmed = true;
      } else {
        match.team_b_lineup = lineup;
        match.team_b_confirmed = true;
      }

      // Handle optional racketball and beginner players with auto-TBC logic
      for (const type of ['racketball', 'beginner']) {
        const fieldKey = `${type}_player`;
        if (!(fieldKey in req.body)) continue;
        const playerName = req.body[fieldKey] || null;
        const ownField = `team_${side}_${type}_player`;
        const otherSide = side === 'a' ? 'b' : 'a';
        const otherField = `team_${otherSide}_${type}_player`;

        match[ownField] = playerName;
        if (playerName && !match[otherField]) {
          match[otherField] = 'TBC';
        } else if (!playerName && match[otherField] === 'TBC') {
          match[otherField] = null;
        }
        match.markModified(ownField);
        match.markModified(otherField);
      }

      await match.save();

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, 'Error saving team lineup');
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:tournamentId/matches/:matchId/result
  // Handles both individual matches and team fixtures (selected by tournament type)
  router.post(
    '/:tournamentId/matches/:matchId/result',
    requireAdmin,
    async (req, res) => {
      try {
        const { tournamentId, matchId } = req.params;

        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        const tournamentMatch = await TournamentMatch.findById(matchId);
        if (!tournamentMatch) return res.status(404).json({ error: 'Tournament match not found' });

        if (tournamentMatch.status === 'completed' || tournamentMatch.status === 'walkover') {
          return res.status(409).json({ error: 'Match result already recorded' });
        }

        // Validate body against the appropriate schema
        const schema = tournament.tournament_type === 'team' ? teamFixtureResultSchema : matchResultSchema;
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
        }

        const matchResult = parsed.data;

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
                completed: update.completed || false,
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

  // PATCH /:tournamentId/matches/:matchId/result — edit a completed match result
  router.patch(
    '/:tournamentId/matches/:matchId/result',
    async (req, res) => {
      try {
        const { tournamentId, matchId } = req.params;

        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        const tournamentMatch = await TournamentMatch.findById(matchId);
        if (!tournamentMatch) return res.status(404).json({ error: 'Tournament match not found' });
        if (tournamentMatch.status !== 'completed') {
          return res.status(400).json({ error: 'Match is not completed' });
        }

        // Validate with the appropriate schema
        const schema = tournament.tournament_type === 'team' ? teamFixtureResultSchema : matchResultSchema;
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
        }

        const allMatches = await TournamentMatch.find({ tournament_id: tournamentId });
        const { passphrase: _p, ...matchResult } = parsed.data;

        const [groups] = await Promise.all([
          TournamentGroup.find({ tournament_id: tournamentId }),
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
        tournament.status = 'active';
        await tournament.save();

        if (result.updatedMatches && result.updatedMatches.length > 0) {
          await Promise.all(
            result.updatedMatches.map(({ _id, ...fields }) =>
              TournamentMatch.findByIdAndUpdate(_id, { $set: fields }, { new: true })
            )
          );
        }

        if (result.standingsUpdates && result.standingsUpdates.length > 0) {
          await Promise.all(
            result.standingsUpdates.map((update) =>
              TournamentGroup.findByIdAndUpdate(update.group_id, {
                standings: update.standings,
                completed: update.completed || false,
                updated_at: new Date(),
              })
            )
          );
        }

        res.json({ success: true, message: 'Match result updated' });
      } catch (error) {
        if (error.code === 'BRACKET_LOCKED') {
          return res.status(409).json({ error: error.message });
        }
        logger.error({ err: error }, 'Error updating match result');
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
