const { Router } = require('express');
const Match = require('../models/Match');
const validate = require('../middleware/validate');
const requireAdmin = require('../middleware/auth');
const { matchSchema } = require('../schemas/index');

const router = Router();

router.post('/', validate(matchSchema), async (req, res) => {
  try {
    const match = new Match(req.body);
    await match.save();
    res.status(201).json(match);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: -1 });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
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

router.delete('/:id', requireAdmin, async (req, res) => {
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

router.delete('/', requireAdmin, async (req, res) => {
  if (!req.body.confirm) {
    return res.status(400).json({ error: 'Set confirm: true in request body to delete all matches' });
  }
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

module.exports = router;
