const { Sequelize } = require('sequelize');
const { initModels } = require('../db/models');
const { createRouter } = require('../routes');
const { generateOpenApi } = require('./api-contract');

function buildContract() {
  // Registration needs model metadata, not a database or environment secrets.
  // No authentication, network connection, mail or object storage is invoked.
  const sequelize = new Sequelize('postgres://contract:offline@localhost:5432/nitewide_contract', { logging: false });
  const models = initModels(sequelize);
  const noop = () => undefined;
  const controller = new Proxy({}, { get: () => noop });
  const requireUser = noop;
  const router = createRouter({ models, permissions: {}, auth: {}, requireUser,
    publicController: controller, managementController: controller, commerceController: controller, authController: controller,
    invitations: {}, notifications: {}, email: { enabled: false } });
  return { document: generateOpenApi(router.contracts), contracts: router.contracts, router };
}
module.exports = { buildContract };
