require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { importPoshSnapshot, assertLocalDemoDatabase } = require('./posh-importer');
const snapshot = require('./fixtures/posh-orlando-2026-09-21');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
    throw new Error('Usage: npm run db:seed:posh -- [--dry-run | --apply]');
  }
  const config = getConfig();
  assertLocalDemoDatabase(config);
  const sequelize = createSequelize(config);
  try {
    console.log(JSON.stringify(await importPoshSnapshot({ sequelize, models: initModels(sequelize), config, snapshot, apply: args.includes('--apply') }), null, 2));
  } finally { await sequelize.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
