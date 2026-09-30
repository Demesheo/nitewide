require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { getConfig } = require('./config'); const { createSequelize } = require('./db/sequelize'); const { initModels } = require('./db/models'); const { createApp } = require('./app');
const config = getConfig(); const sequelize = createSequelize(config); const models = initModels(sequelize); const app = createApp({ sequelize, models, config });
const server = app.listen(config.PORT, config.bindHost, () => console.log(`Nitewide API listening on ${config.bindHost}:${config.PORT}`));
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 30000);
  deadline.unref();
  server.close(async () => { try { await sequelize.close(); clearTimeout(deadline); }
    catch (error) { console.error('API shutdown failed:', error.code || error.name); process.exitCode = 1; } });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
