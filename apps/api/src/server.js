require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { getConfig } = require('./config'); const { createSequelize } = require('./db/sequelize'); const { initModels } = require('./db/models'); const { createApp } = require('./app');
const config = getConfig(); const sequelize = createSequelize(config); const models = initModels(sequelize); const app = createApp({ sequelize, models, config });
const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`Nitewide API listening on port ${config.PORT}`));
const emailTimer = app.locals.emailService.enabled
  ? setInterval(() => app.locals.emailService.drain().catch((error) => console.error('Email outbox drain failed:', error.code || error.name)), 15000)
  : null;
if (emailTimer) app.locals.emailService.drain().catch((error) => console.error('Email outbox drain failed:', error.code || error.name));
async function shutdown() { if (emailTimer) clearInterval(emailTimer); server.close(async () => { await sequelize.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
