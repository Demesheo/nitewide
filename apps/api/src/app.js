const express = require('express'); const cors = require('cors'); const helmet = require('helmet');
const { createPublicController } = require('./controllers/public-controller');
const { createManagementController } = require('./controllers/management-controller');
const { createCommerceController } = require('./controllers/commerce-controller');
const { createAuthController } = require('./controllers/auth-controller');
const { createPermissionService } = require('./services/permission-service');
const { createCheckoutService } = require('./services/checkout-service');
const { createGuestlistService } = require('./services/guestlist-service');
const { createCheckInService } = require('./services/checkin-service');
const { createAuthService } = require('./services/auth-service');
const { createGuestlistInvitationService } = require('./services/guestlist-invitation-service');
const { createNotificationService } = require('./services/notification-service');
const { createRouter } = require('./routes'); const { createRequireUser, errorHandler } = require('./http/middleware');
const { createMediaRouter } = require('./routes/media');
const { createEmailService } = require('./services/email-service');
const { createNotificationJobService } = require('./services/notification-job-service');
const { createResendWebhookService } = require('./services/resend-webhook-service');
const { createAbuseService } = require('./services/abuse-service');
const { asyncHandler } = require('./http/middleware');

function createApp({ sequelize, models, config, healthCheck = () => sequelize.authenticate(), services = {}, staticRoot }) {
  const app = express(); app.disable('x-powered-by');
  // Hosted HTML must permit the final private-image redirect, not just /api/media.
  // Path-style S3 URLs use this exact origin; no wildcard Cloudflare permission.
  const imageSources = ["'self'", 'data:'];
  if (config.R2_ACCOUNT_ID) imageSources.push(new URL(config.R2_ENDPOINT || `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).origin);
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: imageSources } } }));
  app.set('trust proxy', config.trustProxy ?? (config.hostedDemo ? 1 : false));
  app.get('/health', async (_req, res) => { try { await healthCheck(); res.json({ status: 'ok', service: 'nitewide-api' }); } catch (_error) { res.status(503).json({ status: 'degraded', service: 'nitewide-api' }); } });
  if (config.hostedDemo) {
    app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.set('Cache-Control', 'no-store'); next(); });
    // The shared demo is public; normal account authentication and role checks remain.
    app.get('/demo-access', (_req, res) => res.redirect(302, '/'));
  }
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) }));
  const webhook = createResendWebhookService({ models, secret: config.RESEND_WEBHOOK_SECRET });
  app.post('/api/webhooks/resend', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res, next) => {
    try {
      const result = await webhook.receive(req.body, req.headers);
      if (result.body) res.status(result.status).json(result.body);
      else res.status(result.status).end();
    } catch (error) { next(error); }
  });
  app.use(express.json({ limit: '1mb' }));
  const permissions = services.permissions || createPermissionService(models);
  const notifications = createNotificationService(models);
  const email = services.email || createEmailService({ sequelize, models, apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, encryptionKey: config.EMAIL_ENCRYPTION_KEY, testMode: config.resendTestMode });
  app.locals.emailService = email;
  const notificationJobs = services.notificationJobs || createNotificationJobService({ sequelize, models });
  app.locals.notificationJobs = notificationJobs;
  const invitations = createGuestlistInvitationService({ sequelize, models, permissions, email, customerAppUrl: config.CUSTOMER_APP_URL });
  const auth = services.auth || createAuthService({ sequelize, models, tokenSecret: config.AUTH_TOKEN_SECRET, invitations, email, customerAppUrl: config.CUSTOMER_APP_URL });
  const abuse = services.abuse || createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET });
  app.use('/api', asyncHandler(async (req, res, next) => { res.set('Cache-Control', 'no-store'); await abuse.before(req); next(); }));
  const requireUser = createRequireUser({ authenticate: auth.authenticate, allowDevelopmentUserHeader: config.NODE_ENV !== 'production', abuse });
  app.use('/api', createMediaRouter({ models, requireUser, config, uploadDir: config.MEDIA_UPLOAD_DIR, storage: services.mediaStorage }));
  const guestlistService = services.requestGuestlist && services.reviewGuestlist ? null : createGuestlistService({ sequelize, models, permissions, email, customerAppUrl: config.CUSTOMER_APP_URL, businessAppUrl: config.businessAppUrl, reviewEmailsEnabled: config.businessGuestlistReviewEmails });
  const dependencies = {
    models, permissions, auth, email,
    checkout: services.checkout || createCheckoutService({ sequelize, models, notificationJobs, environment: config.NODE_ENV, hostedDemo: config.hostedDemo, email, customerAppUrl: config.CUSTOMER_APP_URL }),
    requestGuestlist: services.requestGuestlist || guestlistService.request,
    reviewGuestlist: services.reviewGuestlist || guestlistService.review,
    checkIn: services.checkIn || createCheckInService({ sequelize, models, permissions, tokenSecret: config.QR_TOKEN_SECRET, environment: config.NODE_ENV, hostedDemo: config.hostedDemo }),
  };
  const router = createRouter({ publicController: createPublicController(dependencies), managementController: createManagementController({ ...dependencies, businessAppUrl: config.businessAppUrl }), commerceController: createCommerceController(dependencies), authController: createAuthController(dependencies), auth, requireUser, models, permissions, invitations, notifications, email, customerAppUrl: config.CUSTOMER_APP_URL, businessAppUrl: config.businessAppUrl, qrTokenSecret: config.QR_TOKEN_SECRET, deliveryTrackingConfigured: Boolean(config.RESEND_WEBHOOK_SECRET) });
  app.locals.reportExports = router.reportExports;
  app.use('/api', router);
  app.use('/api/admin/background', requireUser, require('./routes/background-jobs').createBackgroundJobRouter({ sequelize, models, permissions, email, notificationJobs }));
  if (config.hostedDemo) require('./http/demo-static').installDemoStatic(app, staticRoot);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })); app.use(errorHandler); return app;
}
module.exports = { createApp };
