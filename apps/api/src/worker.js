require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { getConfig } = require('./config');
const { createSequelize } = require('./db/sequelize');
const { initModels } = require('./db/models');
const { backgroundServices, createWorkerRuntime } = require('./background/runtime');

async function main() {
  const config = getConfig(), sequelize = createSequelize(config), models = initModels(sequelize);
  const runtime = createWorkerRuntime({ sequelize, services: backgroundServices({ sequelize, models, config }), pollIntervalMs: config.WORKER_POLL_INTERVAL_MS });
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => { console.error('Worker shutdown deadline exceeded; leases will recover remaining work.'); process.exit(1); }, config.WORKER_SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    try { await runtime.stop(); await sequelize.close(); }
    catch (error) { console.error('Worker shutdown failed:', error.code || error.name); process.exitCode = 1; }
    finally { clearTimeout(deadline); }
  }
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try { await runtime.start(); console.log('Nitewide background worker started (email, notifications, exports).'); }
  catch (error) { await sequelize.close(); throw error; }
}
if (require.main === module) main().catch(error => { console.error('Worker startup failed:', error.code || error.name); process.exitCode = 1; });
module.exports = { main };
