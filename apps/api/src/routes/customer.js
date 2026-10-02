const querySchemas = require('../http/domain-query-schemas');
const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/schemas');
const { z } = require('zod');
const { optionalPhone } = require('../domain/phone');

function registerCustomerRoutes({ router, commerceController, paymentController, requireUser, invitations, notifications, account, saved }) {
  router.use('/customer', requireUser, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/customer/checkout-attempts/:idempotencyKey', asyncHandler(paymentController?.lookup || commerceController.getCheckoutAttempt));
  router.get('/customer/bookings', asyncHandler(async (req, res) => res.json({ data: await account.bookings(req.userId, querySchemas.bookings.parse(req.query)) })));
  router.get('/customer/saved', asyncHandler(async (req, res) => res.json({ data: await saved.list(req.userId, querySchemas.saved.parse(req.query)) })));
  router.get('/customer/saved/ids', asyncHandler(async (req, res) => {
    const ids = querySchemas.savedIds.parse(req.query).eventIds;
    res.json({ data: await saved.ids(req.userId, [...new Set(ids)]) });
  }));
  router.post('/customer/saved/merge', validate(z.object({ eventIds: z.array(z.uuid()).max(100) }).strict()), asyncHandler(async (req, res) => res.json({ data: await saved.merge(req.userId, req.body.eventIds) })));
  router.put('/customer/saved/:eventId', asyncHandler(async (req, res) => res.json({ data: await saved.save(req.userId, z.uuid().parse(req.params.eventId)) })));
  router.delete('/customer/saved/:eventId', asyncHandler(async (req, res) => res.json({ data: await saved.remove(req.userId, z.uuid().parse(req.params.eventId)) })));
  router.get('/customer/tickets/:id', asyncHandler(async (req, res) => res.json({ data: await account.ticket(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/purchases/:id/tickets', asyncHandler(async (req, res) => res.json({ data: await account.purchaseTickets(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/guestlists/:id/pass', asyncHandler(async (req, res) => res.json({ data: await account.guestlistPass(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/events/:eventId/guestlist', asyncHandler(async (req, res) => res.json({ data: await account.guestlistStatus(req.userId, z.uuid().parse(req.params.eventId), querySchemas.guestlistStatus.parse(req.query)) })));
  router.patch('/customer/guestlists/:entryId', validate(z.object({ partySize: z.number().int().min(1).max(20) }).strict()), asyncHandler(async (req, res) => res.json({ data: await account.updatePendingGuestlist(req.userId, z.uuid().parse(req.params.entryId), req.body.partySize) })));
  router.delete('/customer/guestlists/:entryId', asyncHandler(async (req, res) => res.json({ data: await account.withdrawPendingGuestlist(req.userId, z.uuid().parse(req.params.entryId)) })));
  router.get('/customer/connections', asyncHandler(async (req, res) => {
    const query = querySchemas.connections.parse(req.query);
    const legacyEventPicker = query.eventId && req.query.page === undefined && req.query.pageSize === undefined;
    res.json({ data: legacyEventPicker ? await account.connections(req.userId, { eventId: query.eventId }) : await account.connectionsPage(req.userId, query) });
  }));
  const connectionPeople = asyncHandler(async (req, res) => res.json({ data: await account.connectionHistory(req.userId, querySchemas.connectionPeople.parse(req.query)) }));
  router.get('/customer/connections/summary', connectionPeople);
  router.get('/customer/connections/people', connectionPeople);
  router.patch('/customer/profile', validate(z.object({ displayName: z.string().trim().min(1).max(120), phone: optionalPhone, confirmPhone: optionalPhone.optional(), marketingConsent: z.boolean(), transactionalSmsConsent: z.boolean(), marketingSmsConsent: z.boolean() }).strict()), asyncHandler(async (req, res) => res.json({ data: await account.updateProfile(req.userId, req.body) })));
  // The private link is the authority; no login or customer ID is required.
  router.post('/guestlist-invitations/:token/claim', asyncHandler(async (req, res) => res.json({ data: await invitations.claim(req.params.token) })));
  router.get('/guestlist-invitations/:token/pass', asyncHandler(async (req, res) => res.json({ data: await invitations.pass(req.params.token) })));
  router.get('/notifications', requireUser, asyncHandler(async (req, res) => {
    if (req.query.page === undefined && req.query.pageSize === undefined) {
      const [items, unreadCount] = await Promise.all([notifications.list(req.userId), notifications.unreadCount(req.userId)]);
      return res.json({ data: { items, unreadCount } });
    }
    return res.json({ data: await notifications.page(req.userId,
      querySchemas.notifications.parse(req.query)) });
  }));
  router.post('/notifications/:id/read', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.markRead(req.userId, req.params.id) })));
  router.delete('/notifications', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.clearAll(req.userId) })));
  router.delete('/notifications/:id', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.dismiss(req.userId, req.params.id) })));
  router.post('/events/:eventId/guestlist', requireUser, validate(schemas.guestlist), asyncHandler(commerceController.requestGuestlist));
  router.post('/orders', requireUser, validate(schemas.checkout), asyncHandler(commerceController.checkout));
  router.get('/orders/:orderId', requireUser, asyncHandler(commerceController.getOrder));
}
module.exports = { registerCustomerRoutes };
