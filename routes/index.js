import express from 'express';
import usersRouter from './users.js';
import organizationsRouter from './organizations.js';
import eventsRouter from './events.js';
import guestlistsRouter from './guestlists.js';
import ticketsRouter from './tickets.js';

const router = express.Router();

router.use('/users', usersRouter);
router.use('/organizations', organizationsRouter);
router.use('/events', eventsRouter);
router.use('/guestlists', guestlistsRouter);
router.use('/tickets', ticketsRouter);

export default router;
