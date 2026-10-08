const { asyncHandler, validate } = require('./contract-router');
const { z } = require('zod');

function registerPublicRoutes({ router, publicController, referralLinks }) {
  router.post('/events/:eventId/referral-visits', validate(z.object({ code: z.string().min(3).max(48), sessionKey: z.string().uuid().optional() })), asyncHandler(async (req, res) => res.json({ data: await referralLinks.visit(req.params.eventId, req.body.code, req.body.sessionKey) })));
  router.get('/events', asyncHandler(publicController.listEvents));
  router.get('/discovery/areas', asyncHandler(publicController.discoveryAreas));
  router.get('/events/batch', asyncHandler(publicController.batchEvents));
  router.get('/events/:eventId', asyncHandler(publicController.getEvent));
}
module.exports = { registerPublicRoutes };
