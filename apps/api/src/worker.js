require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env'), quiet: true });
const { getConfig } = require('./config');
const { createSequelize } = require('./db/sequelize');
const { initModels } = require('./db/models');
const { backgroundServices, createWorkerRuntime } = require('./background/runtime');
const { createWorkerShutdown } = require('./background/shutdown');
const { createDiagnostics } = require('./diagnostics/observability');

async function main() {
  const config = getConfig(), sequelize = createSequelize(config), models = initModels(sequelize);
  const runtime = createWorkerRuntime({ sequelize, services: backgroundServices({ sequelize, models, config }), pollIntervalMs: config.WORKER_POLL_INTERVAL_MS });
  const shutdown = createWorkerShutdown({ runtime, sequelize, diagnostics: sequelize.diagnostics, timeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS });
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try { await runtime.start(); sequelize.diagnostics.log('worker_started'); }
  catch {
    sequelize.diagnostics.log('worker_startup_failed', { outcome: 'error' }, 'error');
    await shutdown(1);
  }
}
if (require.main === module) main().catch(() => {
  createDiagnostics().log('worker_startup_failed', { outcome: 'error' }, 'error');
  process.exit(1);
});
module.exports = { main };
