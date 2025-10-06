import express from 'express';
import {
  createGuestlistEntry,
  getGuestlist,
  getAllGuestlistEntries,
  updateGuestlistEntry,
  deleteGuestlistEntry,
} from '../controllers/guestlistController.js';

const router = express.Router();

// CRUD
router.post('/', createGuestlistEntry);
router.get('/', getAllGuestlistEntries);
router.get('/:id', getGuestlist);
router.put('/:id', updateGuestlistEntry);
router.delete('/:id', deleteGuestlistEntry);

export default router;
