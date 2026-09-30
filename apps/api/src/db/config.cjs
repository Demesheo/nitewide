require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });

const { databaseConnectionConfig } = require('./connection-config');

function migrationConfig(nodeEnv) {
  const config = databaseConnectionConfig({ ...process.env, NODE_ENV: nodeEnv });
  return {
    url: config.databaseUrl,
    dialect: 'postgres',
    migrationStorageTableName: 'sequelize_meta',
    dialectOptions: config.databaseTls ? { ssl: config.databaseTls } : {},
  };
}

// Lazy getters validate only the selected CLI environment; --env production
// must enforce TLS even if the caller forgot to export NODE_ENV.
module.exports = {
  get development() { return migrationConfig('development'); },
  get test() { return migrationConfig('test'); },
  get production() { return migrationConfig('production'); },
};
