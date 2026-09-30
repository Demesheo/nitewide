require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { getConfig } = require('./config'); const { createSequelize } = require('./db/sequelize'); const { initModels } = require('./db/models'); const { createApp } = require('./app');
const config = getConfig(); const sequelize = createSequelize(config); const models = initModels(sequelize); const app = createApp({ sequelize, models, config });
const server = app.listen(config.PORT, config.bindHost, () => console.log(`Nitewide API listening on ${config.bindHost}:${config.PORT}`));
const emailTimer = app.locals.emailService.enabled
  ? setInterval(() => app.locals.emailService.drain().catch((error) => console.error('Email outbox drain failed:', error.code || error.name)), 15000)
  : null;
if (emailTimer) app.locals.emailService.drain().catch((error) => console.error('Email outbox drain failed:', error.code || error.name));
const exportTimer = setInterval(() => app.locals.reportExports.drain().catch((error) => console.error('Report export worker failed:', error.code || error.name)), 2000);
async function shutdown() {
  clearInterval(exportTimer);
  if (emailTimer) clearInterval(emailTimer);
  await app.locals.reportExports.stop();
  server.close(async () => { await sequelize.close(); process.exit(0); });
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
