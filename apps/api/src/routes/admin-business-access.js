const { validate } = require('./contract-router');
const { createAdminBusinessAccessService, ownershipInvitationSchema, ownershipRemoveSchema, ownershipRecoverySchema, financePermissionSchema } = require('../services/admin-business-access-service');
function registerAdminBusinessAccess({ router, models, permissions, onboardingService, requireUser, asyncHandler }) {
  const service = createAdminBusinessAccessService({ models, permissions, onboardingService });
  router.get('/admin/businesses/:id/ownership', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.detail(req.userId, req.params.id) })));
  router.post('/admin/businesses/:id/ownership/invitations', requireUser, validate(ownershipInvitationSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.invite(req.userId, req.params.id, req.body) })));
  router.post('/admin/businesses/:id/ownership/:userId/remove', requireUser, validate(ownershipRemoveSchema), asyncHandler(async (req, res) => res.json({ data: await service.remove(req.userId, req.params.id, req.params.userId, req.body) })));
  router.post('/admin/businesses/:id/ownership/recovery', requireUser, validate(ownershipRecoverySchema), asyncHandler(async (req, res) => res.json({ data: await service.recover(req.userId, req.params.id, req.body) })));
  router.put('/admin/businesses/:id/finance/:userId', requireUser, validate(financePermissionSchema), asyncHandler(async (req, res) => res.json({ data: await service.finance(req.userId, req.params.id, req.params.userId, req.body) })));
  return service;
}
function registerBusinessFinanceAccess({ router, service, requireUser, asyncHandler }) {
  router.put('/business/organizations/:id/members/:userId/finance', requireUser, validate(financePermissionSchema), asyncHandler(async (req, res) => res.json({ data: await service.finance(req.userId, req.params.id, req.params.userId, req.body, false) })));
}
module.exports = { registerAdminBusinessAccess, registerBusinessFinanceAccess };
