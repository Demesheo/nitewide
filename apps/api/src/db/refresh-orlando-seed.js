require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../../.env') });
const { getConfig } = require('../config');
const { createSequelize } = require('./sequelize');
const { initModels } = require('./models');
const { cleanSeedPurchases } = require('./clean-seed-purchases');
const { mergeRoom22, provisionDemoVenues } = require('./seed-venue-expansion');
const { importPoshSnapshot } = require('./posh-importer');
const snapshot = require('./fixtures/posh-orlando-2026-09-22');
async function refreshOrlandoSeed(args) {
  const cleanup = await cleanSeedPurchases(args);
  const { removedOrderIds, ...summary } = cleanup;
  const grouping = await mergeRoom22(args);
  const replacement = await require('./replace-room22-friday').replaceRoom22Friday(args);
  const venues = await provisionDemoVenues({ ...args, snapshot });
  const events = await importPoshSnapshot({ ...args, snapshot });
  return { cleanup: summary, grouping, replacement, venues, events };
}
async function main() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(f => !['--apply', '--dry-run'].includes(f))) throw new Error('Use --dry-run or --apply');
  const config = getConfig(), sequelize = createSequelize(config);
  try { console.log(JSON.stringify(await refreshOrlandoSeed({ config, sequelize, models: initModels(sequelize), apply: flags.includes('--apply') }), null, 2)); }
  finally { await sequelize.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { refreshOrlandoSeed };
