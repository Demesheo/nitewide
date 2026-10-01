const { asyncHandler, validate } = require('./contract-router');
const adminSchemas = require('../http/admin-schemas');

function registerAdminRoutes({ router, managementController, auth, requireUser, models, permissions, email, customerAppUrl, businessAppUrl, admin }) {
  require('./admin-onboarding').registerAdminOnboarding({ router, models, permissions, email, customerAppUrl, businessAppUrl, auth, requireUser, asyncHandler });
  router.get('/admin/workspace', requireUser, asyncHandler(async (req, res) => res.json({ data: await admin.workspace(req.userId, adminSchemas.reportQuery.parse(req.query)) })));
  require('./admin-management').registerAdminManagement({ router, models, permissions, email, customerAppUrl, businessAppUrl, requireUser, asyncHandler });
  router.get('/admin/operations', requireUser, asyncHandler(async (req, res) => res.json({ data: await admin.operations(req.userId, adminSchemas.operationsQuery.parse(req.query)) })));
  for (const entity of ['users', 'organizations', 'events']) router.patch(`/admin/${entity}/:id`, requireUser, asyncHandler(async (req) => {
    await permissions.assertInternal(req.userId);
    throw require('../domain/errors').conflict('Use the versioned Management editor or lifecycle actions.', 'LEGACY_ADMIN_EDIT_DISABLED');
  }));
  router.post('/admin/demo-users', requireUser, validate(adminSchemas.demoUser), asyncHandler(async (req, res) => res.status(201).json({ data: await admin.createDemoUser(req.userId, req.body) })));
  router.get('/admin/overview', requireUser, asyncHandler(managementController.adminOverview));
}
module.exports = { registerAdminRoutes };
