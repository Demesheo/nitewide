import express from 'express';
import {
  createTicket,
  getTicket,
  getAllTickets,
  updateTicket,
  deleteTicket,
} from '../controllers/ticketController.js';

const router = express.Router();

// CRUD
router.post('/', createTicket);
router.get('/', getAllTickets);
router.get('/:id', getTicket);
router.put('/:id', updateTicket);
router.delete('/:id', deleteTicket);

export default router;
