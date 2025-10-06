import { Event, User, EventAffiliate } from '../models/index.js';

export const createEvent = async (req, res) => {
  try {
    const event = await Event.create(req.body);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllEvents = async (req, res) => {
  try {
    const events = await Event.findAll({ include: ['eventAffiliates'] });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getEvent = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id, { include: ['eventAffiliates'] });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateEvent = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    await event.update(req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    await event.destroy();
    res.json({ message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Event Affiliates Management ---
export const addEventAffiliate = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    const { userId } = req.body;
    if (!event) return res.status(404).json({ error: 'Event not found' });

    await event.addEventAffiliate(userId);
    const affiliates = await event.getEventAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getEventAffiliates = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const affiliates = await event.getEventAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const removeEventAffiliate = async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    const { userId } = req.body;
    if (!event) return res.status(404).json({ error: 'Event not found' });

    await event.removeEventAffiliate(userId);
    const affiliates = await event.getEventAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
