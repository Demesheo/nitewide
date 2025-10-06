import { Guestlist, User, Organization, Event } from '../models/index.js';

export const createGuestlistEntry = async (req, res) => {
  try {
    const entry = await Guestlist.create(req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllGuestlistEntries = async (req, res) => {
  try {
    const entries = await Guestlist.findAll();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getGuestlist = async (req, res) => {
  try {
    const entry = await Guestlist.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Guestlist entry not found' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateGuestlistEntry = async (req, res) => {
  try {
    const entry = await Guestlist.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Guestlist entry not found' });
    await entry.update(req.body);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteGuestlistEntry = async (req, res) => {
  try {
    const entry = await Guestlist.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Guestlist entry not found' });
    await entry.destroy();
    res.json({ message: 'Guestlist entry deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
