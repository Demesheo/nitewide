const { createAdminEventService, adminEventInput } = require('../services/admin-event-service');
const { validate, asyncHandler } = require('./contract-router');
function registerAdminEventRoutes({ router, models, permissions, business, requireUser }) {
  const service = createAdminEventService({ models, permissions, business });
  router.get('/admin/businesses/:id/editor-options', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.options(req.userId, req.params.id) })));
  router.get('/admin/events/:id/editor', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.editor(req.userId, req.params.id) })));
  router.get('/admin/events/:id/notification-preview', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.audience(req.userId, req.params.id) })));
  router.post('/admin/events', requireUser, validate(adminEventInput), asyncHandler(async (req, res) => res.status(201).json({ data: await service.save(req.userId, null, req.body) })));
  router.put('/admin/events/:id', requireUser, validate(adminEventInput), asyncHandler(async (req, res) => res.json({ data: await service.save(req.userId, req.params.id, req.body) })));
}
module.exports = { registerAdminEventRoutes };
