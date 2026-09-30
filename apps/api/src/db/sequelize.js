const { Sequelize } = require('sequelize');
const { getConfig } = require('../config');

function createSequelize(config = getConfig()) {
  return new Sequelize(config.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: config.databaseTls ? { ssl: config.databaseTls } : {},
    pool: { min: 0, max: 10, idle: 10_000 },
    define: { underscored: true, timestamps: true },
  });
}

module.exports = { createSequelize };
