const { Router } = require('express');
const Event = require('../models/Event');
const validate = require('../middleware/validate');
const requireAdmin = require('../middleware/auth');
const { eventSchema } = require('../schemas/index');

const router = Router();

router.post('/', validate(eventSchema), async (req, res) => {
  try {
    const existingEvent = await Event.findOne({ name: req.body.name });
    if (existingEvent) {
      return res.status(200).json(existingEvent);
    }
    const event = new Event(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (error) {
    if (error.code === 11000) {
      const existingEvent = await Event.findOne({ name: req.body.name });
      return res.status(200).json(existingEvent);
    }
    res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const events = await Event.find().sort({ date: -1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
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

router.delete('/', requireAdmin, async (req, res) => {
  if (!req.body.confirm) {
    return res.status(400).json({ error: 'Set confirm: true in request body to delete all events' });
  }
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

module.exports = router;
