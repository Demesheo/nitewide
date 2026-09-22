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

function createApp({ sequelize, models, config, healthCheck = () => sequelize.authenticate(), services = {} }) {
  const app = express(); app.disable('x-powered-by'); app.use(helmet());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) }));
  app.use(express.json({ limit: '1mb' }));
  const permissions = services.permissions || createPermissionService(models);
  const invitations = createGuestlistInvitationService({ sequelize, models, permissions });
  const notifications = createNotificationService(models);
  const auth = services.auth || createAuthService({ sequelize, models, tokenSecret: config.AUTH_TOKEN_SECRET, invitations });
  const requireUser = createRequireUser({ authenticate: auth.authenticate, allowDevelopmentUserHeader: config.NODE_ENV !== 'production' });
  app.use('/api', createMediaRouter({ models, requireUser, uploadDir: config.MEDIA_UPLOAD_DIR }));
  const guestlistService = services.requestGuestlist && services.reviewGuestlist ? null : createGuestlistService({ sequelize, models });
  const dependencies = {
    models, permissions, auth,
    checkout: services.checkout || createCheckoutService({ sequelize, models, environment: config.NODE_ENV }),
    requestGuestlist: services.requestGuestlist || guestlistService.request,
    reviewGuestlist: services.reviewGuestlist || guestlistService.review,
    checkIn: services.checkIn || createCheckInService({ sequelize, models }),
  };
  app.get('/health', async (_req, res) => { try { await healthCheck(); res.json({ status: 'ok', service: 'nitewide-api' }); } catch (_error) { res.status(503).json({ status: 'degraded', service: 'nitewide-api' }); } });
  app.use('/api', createRouter({ publicController: createPublicController(dependencies), managementController: createManagementController(dependencies), commerceController: createCommerceController(dependencies), authController: createAuthController(dependencies), requireUser, models, permissions, invitations, notifications }));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })); app.use(errorHandler); return app;
}
module.exports = { createApp };
