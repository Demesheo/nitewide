require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });

const base = {
  url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nitewide',
  dialect: 'postgres',
  migrationStorageTableName: 'sequelize_meta',
  dialectOptions: process.env.DATABASE_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {},
};

module.exports = { development: base, test: base, production: base };

