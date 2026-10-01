const querySchemas = require('../http/domain-query-schemas');
const { createAdminOnboardingService, onboardingSchema, onboardingChangeSchema, onboardingAcceptSchema } = require('../services/admin-onboarding-service');
const { validate } = require('./contract-router');
function registerAdminOnboarding({ router, models, permissions, email, customerAppUrl, businessAppUrl, auth, requireUser, asyncHandler }) {
  const service = createAdminOnboardingService({ models, permissions, email, customerAppUrl, businessAppUrl });
  router.post('/admin/onboarding', requireUser, validate(onboardingSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.userId, req.body) })));
  router.post('/admin/onboarding/:id/resend', requireUser, validate(onboardingChangeSchema), asyncHandler(async (req, res) => res.json({ data: await service.resend(req.userId, req.params.id, req.body) })));
  router.post('/admin/onboarding/:id/revoke', requireUser, validate(onboardingChangeSchema), asyncHandler(async (req, res) => res.json({ data: await service.revoke(req.userId, req.params.id, req.body) })));
  router.get('/auth/onboarding/preview', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await service.preview(querySchemas.onboardingPreview.parse(req.query).token) });
  }));
  router.post('/auth/onboarding/accept', validate(onboardingAcceptSchema), asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { token, ...input } = onboardingAcceptSchema.parse(req.body);
    let userId = null;
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (bearer) userId = (await auth.authenticate(bearer)).id;
    res.json({ data: await service.accept(token, input, userId) });
  }));
  return service;
}
module.exports = { registerAdminOnboarding };
