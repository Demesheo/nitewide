import express from 'express';
import {
  createEvent,
  getEvent,
  getAllEvents,
  updateEvent,
  deleteEvent,
  addEventAffiliate,
  removeEventAffiliate,
  getEventAffiliates,
} from '../controllers/eventController.js';

const router = express.Router();

// CRUD
router.post('/', createEvent);
router.get('/', getAllEvents);
router.get('/:id', getEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

// Event Affiliates as subresource
router.post('/:id/affiliates', addEventAffiliate);
router.get('/:id/affiliates', getEventAffiliates);
router.delete('/:id/affiliates', removeEventAffiliate);

export default router;
