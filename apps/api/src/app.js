const express = require('express'); const cors = require('cors'); const helmet = require('helmet');
const { createPublicController } = require('./controllers/public-controller');
const { createManagementController } = require('./controllers/management-controller');
const { createCommerceController } = require('./controllers/commerce-controller');
const { createPermissionService } = require('./services/permission-service');
const { createCheckoutService } = require('./services/checkout-service');
const { createGuestlistService } = require('./services/guestlist-service');
const { createCheckInService } = require('./services/checkin-service');
const { createRouter } = require('./routes'); const { errorHandler } = require('./http/middleware');

function createApp({ sequelize, models, config, healthCheck = () => sequelize.authenticate(), services = {} }) {
  const app = express(); app.disable('x-powered-by'); app.use(helmet());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) }));
  app.use(express.json({ limit: '1mb' }));
  const permissions = services.permissions || createPermissionService(models);
  const dependencies = {
    models, permissions,
    checkout: services.checkout || createCheckoutService({ sequelize, models }),
    joinGuestlist: services.joinGuestlist || createGuestlistService({ sequelize, models }),
    checkIn: services.checkIn || createCheckInService({ sequelize, models }),
  };
  app.get('/health', async (_req, res) => { try { await healthCheck(); res.json({ status: 'ok', service: 'nitewide-api' }); } catch (_error) { res.status(503).json({ status: 'degraded', service: 'nitewide-api' }); } });
  app.use('/api', createRouter({ publicController: createPublicController(dependencies), managementController: createManagementController(dependencies), commerceController: createCommerceController(dependencies) }));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })); app.use(errorHandler); return app;
}
module.exports = { createApp };

