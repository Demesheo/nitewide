const { z } = require('zod');
const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/schemas');
const businessSchemas = require('../http/business-schemas');

function registerCustomerMyEventsRoutes({ router, requireUser, myEvents }) {
  const eventId = (req) => z.uuid().parse(req.params.eventId);
  const entryId = (req) => z.uuid().parse(req.params.entryId);
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const get = (path, handle) => router.get(path, requireUser, noStore, asyncHandler(async (req, res) => res.json({ data: await handle(req) })));
  get('/customer/my-events/access', (req) => myEvents.eligibility(req.userId));
  get('/customer/my-events', (req) => myEvents.events(req.userId, businessSchemas.eventListQuery.parse(req.query)));
  get('/customer/my-events/:eventId', (req) => myEvents.detail(req.userId, eventId(req)));
  get('/customer/my-events/:eventId/referral-link', (req) => myEvents.referralLink(req.userId, eventId(req)));
  get('/customer/my-events/:eventId/guestlist-invite-pools', (req) => myEvents.invitePools(req.userId, eventId(req)));
  get('/customer/my-events/:eventId/guestlist-page', (req) => myEvents.guestlist(req.userId, eventId(req), businessSchemas.eventPageQuery.parse(req.query)));
  get('/customer/my-events/:eventId/guestlist-page/:entryId', (req) => myEvents.guestlistEntry(req.userId, eventId(req), entryId(req)));
  get('/customer/my-events/:eventId/guestlist/:entryId/invitation-link', (req) => myEvents.invitationLink(req.userId, eventId(req), entryId(req)));
  router.post('/customer/my-events/:eventId/guestlist-invitations', requireUser, noStore, validate(schemas.guestlistInvite),
    asyncHandler(async (req, res) => res.status(201).json({ data: await myEvents.invite(req.userId, eventId(req), req.body) })));
  router.post('/customer/my-events/:eventId/guestlist/:entryId/decision', requireUser, noStore, validate(schemas.guestlistDecision),
    asyncHandler(async (req, res) => res.json({ data: await myEvents.review(req.userId, eventId(req), entryId(req), req.body) })));
}
module.exports = { registerCustomerMyEventsRoutes };
