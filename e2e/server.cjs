const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const express = require('express');
const { urls, controlToken, isolatedEnvironment, databaseSettings } = require('./environment.cjs');
const { assertManagedTestDatabase, assertGeneratedDatabaseName } = require('../apps/api/scripts/test-database.cjs');

const root = path.resolve(__dirname, '..');
const children = new Set();
let closing = false, connection, database, sequelize, server, workerRuntime;
function child(command, args, env, oneShot = false) {
  const processHandle = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.add(processHandle);
  processHandle.once('error', () => shutdown(1));
  processHandle.once('exit', code => { children.delete(processHandle); if (!closing && (!oneShot || code !== 0)) shutdown(1); });
  return processHandle;
}
function completed(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once('error', reject);
    processHandle.once('exit', code => code === 0 ? resolve() : reject(new Error('Test migration failed')));
  });
}
async function shutdown(code = 0) {
  if (closing) return; closing = true;
  try {
    if (workerRuntime) await workerRuntime.stop();
    const stopped = [...children].map(handle => new Promise(resolve => {
      handle.once('close', resolve); handle.kill('SIGTERM');
      const timer = setTimeout(() => handle.kill('SIGKILL'), 3000); timer.unref();
    }));
    await Promise.all(stopped);
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (sequelize) await sequelize.close();
    if (database) await connection.query(`DROP DATABASE "${assertGeneratedDatabaseName(database)}" WITH (FORCE)`);
    if (connection) await connection.end();
    console.log(database ? 'Playwright servers stopped; disposable database removed.' : 'Playwright resources stopped; no test database was created.');
  } catch (error) {
    console.error(`Playwright cleanup failed (${error.code || 'cleanup error'}). Inspect only the generated database ${database || '(not created)'}.`); code = 1;
  }
  process.exitCode = code;
}
async function start() {
  const settings = databaseSettings();
  connection = new Client({ connectionString: settings.adminUrl, connectionTimeoutMillis: 10000 });
  await connection.connect();
  await connection.query(`CREATE DATABASE "${settings.name}"`); database = settings.name;
  const environment = isolatedEnvironment(settings.databaseUrl);
  Object.assign(process.env, environment); assertManagedTestDatabase();
  await completed(child(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--config', 'apps/api/src/db/config.cjs', '--migrations-path', 'apps/api/src/db/migrations', '--env', 'test'], environment, true));
  const config = require('../apps/api/src/config').getConfig();
  sequelize = require('../apps/api/src/db/sequelize').createSequelize(config);
  const models = require('../apps/api/src/db/models').initModels(sequelize);
  const { seed, seedMyEventsScenario } = require('./seed.cjs');
  let fixture = await seed(models, config);
  let resetting = false, activeQueries = 0;
  const activeResponses = new Set();
  sequelize.addHook('beforeQuery', 'e2e-query-start', () => { activeQueries++; });
  sequelize.addHook('afterQuery', 'e2e-query-end', () => { activeQueries--; });
  async function drainRequests() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      // Closing a browser can abort its response while its database work is
      // still running. Drain both before TRUNCATE to avoid cross-test writes
      // and lock conflicts; allow promise continuations to settle as well.
      if (!activeResponses.size && !activeQueries) {
        await new Promise(resolve => setImmediate(resolve));
        if (!activeResponses.size && !activeQueries) return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Previous application requests did not drain before fixture reset.');
  }
  // Mock only the external email boundary; all application/auth/database logic
  // remains real. The dedicated worker has no Resend key/provider connection.
  const emails = [];
  const email = { enabled: true, queue: async message => { emails.push({ template: message.template, to: message.to }); return `mock-${emails.length}`; } };
  const harness = express(); harness.use(express.json());
  harness.use('/__e2e', (req, res, next) => req.headers['x-e2e-control'] === controlToken ? next() : res.sendStatus(403));
  harness.post('/__e2e/reset', async (_req, res, next) => {
    if (resetting) return res.status(409).json({ error: 'Another fixture reset is running.' });
    resetting = true;
    try {
      assertManagedTestDatabase(); await workerRuntime.stop(); await drainRequests();
      fixture = await seed(models, config); emails.length = 0;
      workerRuntime = makeWorker(); await workerRuntime.start(); res.json(fixture);
    }
    catch (error) { console.error(`Playwright reset failed: ${error.name} (${error.original?.code || error.code || 'reset error'}).`); next(error); }
    finally { resetting = false; }
  });
  harness.get('/__e2e/fixture', (_req, res) => res.json(fixture));
  harness.post('/__e2e/my-events-fixture', async (req, res, next) => {
    try {
      if (resetting) return res.status(409).json({ error: 'Fixture reset is running.' });
      if (typeof req.body.past !== 'boolean') return res.sendStatus(400);
      await drainRequests();
      res.json(await seedMyEventsScenario(models, config, fixture, { past: req.body.past }));
    } catch (error) { next(error); }
  });
  harness.get('/__e2e/emails', (_req, res) => res.json(emails));
  harness.use((req, res, next) => {
    if (resetting) return res.status(503).json({ error: 'Isolated fixtures are being reset.' });
    activeResponses.add(res);
    const finish = () => activeResponses.delete(res);
    res.once('finish', finish); res.once('close', finish);
    next();
  });
  const application = require('../apps/api/src/app').createApp({ sequelize, models, config, services: { email } });
  harness.use(application);
  const { backgroundServices, createWorkerRuntime } = require('../apps/api/src/background/runtime');
  // Same worker runtime as deployment, with independent service instances.
  // Stop every lane before fixture reset to avoid cross-test work. The harness
  // shares its disposable connection; production worker is a separate process.
  function makeWorker() { return createWorkerRuntime({ sequelize,
    services: backgroundServices({ sequelize, models, config }), pollIntervalMs: 50 }); }
  workerRuntime = makeWorker(); await workerRuntime.start();
  server = harness.listen(Number(new URL(urls.api).port), '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  for (const app of ['customer', 'business', 'admin']) {
    const port = new URL(urls[app]).port;
    child(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'preview', '--config', `apps/${app}/vite.config.js`, '--outDir', `apps/${app}/dist`, '--host', '127.0.0.1', '--port', port, '--strictPort'], environment);
  }
  console.log('Isolated Playwright API and built app previews started. Email is mocked.');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown());
if (require.main === module) start().catch(error => { console.error(`Playwright setup failed (${error.code || error.message}). No development or hosted database was changed.`); shutdown(1); });
module.exports = { start, shutdown };
