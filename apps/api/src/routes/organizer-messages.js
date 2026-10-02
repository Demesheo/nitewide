const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/organizer-message-schemas');
function registerOrganizerMessageRoutes({ router, requireUser, organizerMessages }) {
  for (const side of ['customer', 'business']) {
    const path = `/${side}/messages`;
    const output = handler => asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await handler(req) }));
    router.get(path, requireUser, output(req => organizerMessages.list(req.userId, side, req.query)));
    router.get(`${path}/:threadId`, requireUser, output(req => organizerMessages.detail(req.userId, side, req.params.threadId, req.query)));
    router.post(`${path}/:threadId/replies`, requireUser, validate(schemas.replyMessage), output(req => organizerMessages.reply(req.userId, side, req.params.threadId, req.body)));
    router.post(`${path}/:threadId/read`, requireUser, output(req => organizerMessages.markRead(req.userId, side, req.params.threadId)));
  }
  router.post('/customer/orders/:orderId/messages', requireUser, validate(schemas.sendMessage), asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await organizerMessages.contact(req.userId, req.params.orderId, req.body) })));
  router.patch('/business/orders/:orderId/refund-request', requireUser, validate(schemas.resolveRequest), asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await organizerMessages.resolve(req.userId, req.params.orderId, req.body) })));
}
module.exports = { registerOrganizerMessageRoutes };
