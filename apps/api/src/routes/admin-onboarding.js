const { createAdminOnboardingService } = require('../services/admin-onboarding-service');
const { z } = require('zod');
function registerAdminOnboarding({ router, models, permissions, email, customerAppUrl, businessAppUrl, auth, requireUser, asyncHandler }) {
  const service = createAdminOnboardingService({ models, permissions, email, customerAppUrl, businessAppUrl });
  router.post('/admin/onboarding', requireUser, asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.userId, req.body) })));
  router.post('/admin/onboarding/:id/resend', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.resend(req.userId, req.params.id, req.body) })));
  router.post('/admin/onboarding/:id/revoke', requireUser, asyncHandler(async (req, res) => res.json({ data: await service.revoke(req.userId, req.params.id, req.body) })));
  router.get('/auth/onboarding/preview', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await service.preview(z.string().min(20).max(200).parse(req.query.token)) });
  }));
  router.post('/auth/onboarding/accept', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { token, ...input } = z.object({ token: z.string().min(20).max(200), password: z.string().optional(), confirmPassword: z.string().optional() }).strict().parse(req.body);
    let userId = null;
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (bearer) userId = (await auth.authenticate(bearer)).id;
    res.json({ data: await service.accept(token, input, userId) });
  }));
  return service;
}
module.exports = { registerAdminOnboarding };
