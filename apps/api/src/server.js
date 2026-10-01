require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env'), quiet: true });
const { getConfig } = require('./config'); const { createSequelize } = require('./db/sequelize'); const { initModels } = require('./db/models'); const { createApp } = require('./app');
const { createShutdown } = require('./diagnostics/shutdown');
const { createDiagnostics } = require('./diagnostics/observability');
function main() {
  const config = getConfig(); const sequelize = createSequelize(config); const models = initModels(sequelize); const app = createApp({ sequelize, models, config });
  const server = app.listen(config.PORT, config.bindHost, error => {
    // Express 5 invokes the listen callback on a bind failure as well.
    if (!error) app.locals.diagnostics.log('api_started', { port: config.PORT, outcome: 'ok' });
  });
  server.requestTimeout = config.HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(15000, config.HTTP_REQUEST_TIMEOUT_MS);
  server.keepAliveTimeout = 5000;
  const shutdown = createShutdown({ server, sequelize, health: app.locals.health, diagnostics: app.locals.diagnostics, timeoutMs: config.API_SHUTDOWN_TIMEOUT_MS });
  server.on('error', () => {
    app.locals.diagnostics.log('api_startup_failed', { outcome: 'error' }, 'error');
    shutdown(1);
  });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  return { server, app, sequelize };
}
if (require.main === module) {
  try { main(); }
  catch {
    // Startup failures can contain configuration values or connection URLs.
    createDiagnostics().log('api_startup_failed', { outcome: 'error' }, 'error');
    process.exit(1);
  }
}
module.exports = { main };
