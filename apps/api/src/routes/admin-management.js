const { createAdminManagementService } = require('../services/admin-management-service');
const { scopedRoleSchema } = require('../services/admin-role-service');
const { validate } = require('./contract-router');

function registerAdminManagement({ router, models, permissions, email, customerAppUrl, businessAppUrl, requireUser, asyncHandler, environment, hostedDemo, stripe }) {
  const service = createAdminManagementService({ models, permissions, email, customerAppUrl, businessAppUrl, environment, hostedDemo, stripe });
  const roles = require('../services/admin-role-service').createAdminRoleService({ models, permissions });
  const send = (handler) => asyncHandler(async (req, res) => res.json({ data: await handler(req) }));
  router.get('/admin/management/resources', requireUser, send((req) => service.metadata(req.userId)));
  router.post('/admin/management/users/:id/scoped-role', requireUser, validate(scopedRoleSchema), send((req) => roles.change(req.userId, req.params.id, req.body)));
  router.get('/admin/management/:resource', requireUser, send((req) => service.list(req.userId, req.params.resource, req.query)));
  router.get('/admin/management/:resource/:id', requireUser, send((req) => service.detail(req.userId, req.params.resource, req.params.id)));
  router.post('/admin/management/:resource', requireUser, asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.userId, req.params.resource, req.body) })));
  router.patch('/admin/management/:resource/:id', requireUser, send((req) => service.update(req.userId, req.params.resource, req.params.id, req.body)));
  router.post('/admin/management/:resource/:id/actions/:action', requireUser, send((req) => service.action(req.userId, req.params.resource, req.params.id, req.params.action, req.body)));
}

module.exports = { registerAdminManagement };
