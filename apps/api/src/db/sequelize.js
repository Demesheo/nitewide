const { Sequelize } = require('sequelize');
const { getConfig } = require('../config');
const { createDiagnostics, instrumentDatabase } = require('../diagnostics/observability');

function createSequelize(config = getConfig()) {
  const sequelize = new Sequelize(config.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ...(config.databaseTls ? { ssl: config.databaseTls } : {}),
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS ?? 120000,
      lock_timeout: config.DATABASE_LOCK_TIMEOUT_MS ?? 10000,
      idle_in_transaction_session_timeout: config.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS ?? 120000,
      connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS ?? 10000,
    },
    pool: { min: 0, max: 10, idle: 10_000, acquire: config.DATABASE_ACQUIRE_TIMEOUT_MS ?? 30000 },
    define: { underscored: true, timestamps: true },
  });
  return instrumentDatabase(sequelize, createDiagnostics({ level: config.LOG_LEVEL || (config.NODE_ENV === 'test' ? 'silent' : 'info') }));
}

module.exports = { createSequelize };
