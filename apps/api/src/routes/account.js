const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/schemas');
const { z } = require('zod');
const { optionalPhone } = require('../domain/phone');

function registerAccountRoutes({ router, authController, auth, requireUser, models, email, account }) {
  const requireSession = (req, _res, next) => req.authSessionId ? next() : next(new (require('../domain/errors').DomainError)('A signed-in session is required', { code: 'UNAUTHENTICATED', status: 401 }));
  router.post('/auth/logout', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId, req.authSessionId) })));
  router.post('/auth/password/change', requireUser, requireSession, validate(schemas.passwordChange), asyncHandler(async (req, res) => res.json({ data: await auth.changePassword(req.userId, req.authSessionId, req.body) })));
  router.get('/auth/sessions', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.sessions(req.userId, req.authSessionId) })));
  router.post('/auth/sessions/revoke-all', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId) })));
  router.delete('/auth/sessions/:sessionId', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId, z.uuid().parse(req.params.sessionId)) })));
  router.patch('/auth/profile', requireUser, validate(z.object({ displayName: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(320), confirmEmail: z.string().trim().toLowerCase().email().max(320).optional(), phone: optionalPhone, confirmPhone: optionalPhone.optional() }).strict()), asyncHandler(async (req, res) => {
    const prior = await models.User.findByPk(req.userId, { attributes: ['email'] });
    const updated = await account.updateIdentity(req.userId, req.body);
    if (prior?.email !== updated.email) {
      try {
        const delivery = await auth.requestEmailVerification(req.userId);
        return res.json({ data: { ...updated, verificationEmailQueued: delivery.verificationEmailQueued,
          verificationMessage: delivery.verificationEmailQueued
            ? 'Email updated. Check your new inbox to verify the address.'
            : 'Email updated, but verification could not be queued. Retry verification from your profile.' } });
      } catch {
        req.app.locals.diagnostics?.log('account_verification_queue_failed', { requestId: req.requestId, outcome: 'error' }, 'warn');
        return res.json({ data: { ...updated, verificationEmailQueued: false,
          verificationMessage: 'Email updated, but verification could not be sent. Retry verification from your profile.' } });
      }
    }
    res.json({ data: updated });
  }));
  router.post('/auth/register', validate(schemas.register), asyncHandler(authController.register));
  router.post('/auth/sign-in', validate(schemas.signIn), asyncHandler(authController.signIn));
  router.post('/auth/business/sign-in', validate(schemas.signIn), asyncHandler(authController.signInBusiness));
  router.post('/auth/password-reset/request', validate(z.object({ email: z.string().trim().email().max(320) }).strict()), asyncHandler(authController.requestPasswordReset));
  router.post('/auth/password-reset/complete', validate(z.object({ token: z.string().min(20).max(200), password: schemas.password }).strict()), asyncHandler(authController.resetPassword));
  router.post('/auth/email/verify', validate(z.object({ token: z.string().min(20).max(200) }).strict()), asyncHandler(authController.verifyEmail));
  router.post('/auth/email/resend', requireUser, asyncHandler(authController.requestEmailVerification));
  router.get('/auth/me', requireUser, asyncHandler(authController.me));
  router.get('/auth/notification-preferences', requireUser, asyncHandler(async (req, res) => {
    const user = await models.User.findByPk(req.userId, { attributes: ['notificationPreferences'] });
    res.json({ data: { reviewRequests: true, salesActivity: true, inventoryAlerts: true, ...user?.notificationPreferences } });
  }));
  router.patch('/auth/notification-preferences', requireUser,
    validate(z.object({ reviewRequests: z.boolean(), salesActivity: z.boolean(), inventoryAlerts: z.boolean() }).strict()),
    asyncHandler(async (req, res) => {
      res.json({ data: await account.updateNotificationPreferences(req.userId, req.body) });
    }));
}
module.exports = { registerAccountRoutes };
