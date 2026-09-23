require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { getConfig } = require('./config'); const { createSequelize } = require('./db/sequelize'); const { initModels } = require('./db/models'); const { createApp } = require('./app');
const config = getConfig(); const sequelize = createSequelize(config); const models = initModels(sequelize); const app = createApp({ sequelize, models, config });
const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`Nitewide API listening on port ${config.PORT}`));
async function shutdown() { server.close(async () => { await sequelize.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
