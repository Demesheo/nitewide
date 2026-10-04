const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/business-access-schemas');
function registerBusinessAccessRoutes({ router, requireUser, models, permissions, email, customerAppUrl, businessAppUrl }) {
  const onboarding = require('../services/admin-onboarding-service').createAdminOnboardingService({ models, permissions, email, customerAppUrl, businessAppUrl });
  const service = require('../services/business-access-request-service').createBusinessAccessRequestService({ models, permissions, onboarding });
  const manageAccess = asyncHandler(async (req, _res, next) => { await permissions.assertInternal(req.userId); next(); });
  router.post('/business/access-requests', validate(schemas.requestAccess), asyncHandler(async (req,res) => res.status(202).json({ data: await service.submit(req.body) })));
  // Account-scoped requests do not confer Business access or depend on the
  // applicant's role in any existing organization.
  router.post('/account/organization-requests', requireUser, validate(schemas.organizationRequest), asyncHandler(async (req,res) => res.status(202).json({ data: await service.submit(req.body, req.userId) })));
  router.get('/account/organization-requests', requireUser, asyncHandler(async (req,res) => res.json({ data: await service.mine(req.userId, req.query) })));
  router.get('/admin/business-access/requests', requireUser, asyncHandler(async (req,res) => res.json({ data: await service.list(req.userId,req.query) })));
  router.get('/admin/business-access/requests/:id', requireUser, asyncHandler(async (req,res) => res.json({ data: await service.detail(req.userId,req.params.id) })));
  router.post('/admin/business-access/requests/:id/approve', requireUser, manageAccess, validate(schemas.approve), asyncHandler(async (req,res) => res.json({ data: await service.approve(req.userId,req.params.id,req.body) })));
  router.post('/admin/business-access/requests/:id/decline', requireUser, manageAccess, validate(schemas.decline), asyncHandler(async (req,res) => res.json({ data: await service.decline(req.userId,req.params.id,req.body) })));
}
module.exports = { registerBusinessAccessRoutes };
