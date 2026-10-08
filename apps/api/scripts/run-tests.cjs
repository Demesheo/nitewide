#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { offlineEnvironment, postgresUrl, assertLoopbackUrl, assertGeneratedDatabaseName } = require('./test-database.cjs');
const { createTemplateDatabaseManager } = require('./test-database-template.cjs');
const { createProcessSupervisor } = require('./test-process-supervisor.cjs');
const { createTimingCollector } = require('../../../scripts/test-timing.cjs');

const apiRoot = path.resolve(__dirname, '..');
const INTEGRATION_TESTS = ['business-access-request-integration.test.js', 'abuse-session-integration.test.js', 'admissions-integration.test.js', 'business-integration.test.js', 'business-reporting-integration.test.js', 'business-read-integration.test.js', 'admin-onboarding-lifecycle-integration.test.js', 'admin-business-access-integration.test.js', 'admin-report-support-integration.test.js', 'venue-access-integration.test.js', 'public-discovery-integration.test.js', 'customer-experience-integration.test.js', 'referral-reactivation-integration.test.js', 'mutation-concurrency-integration.test.js', 'report-export-integration.test.js', 'notification-worker-integration.test.js', 'email-worker-integration.test.js', 'media-storage-integration.test.js', 'production-diagnostics-integration.test.js', 'api-domain-contract-integration.test.js'];
INTEGRATION_TESTS.push('password-change-integration.test.js');
INTEGRATION_TESTS.push('payment-safety-integration.test.js');
INTEGRATION_TESTS.push('stripe-checkout-integration.test.js');
INTEGRATION_TESTS.push('business-payment-account-integration.test.js');
INTEGRATION_TESTS.push('business-payment-disconnect-integration.test.js');
INTEGRATION_TESTS.push('guestlist-passes-integration.test.js');
INTEGRATION_TESTS.push('customer-my-events-integration.test.js');
INTEGRATION_TESTS.push('customer-rundown-integration.test.js');
INTEGRATION_TESTS.push('guestlist-quantity-integration.test.js');
INTEGRATION_TESTS.push('commission-ledger-integration.test.js');
INTEGRATION_TESTS.push('commission-payment-integration.test.js');
INTEGRATION_TESTS.push('organizer-messages-integration.test.js');
INTEGRATION_TESTS.push('support-messages-integration.test.js');
INTEGRATION_TESTS.push('payment-preflight-integration.test.js');
const DEMO_TESTS = ['orlando-seed-integration.test.js', 'posh-importer-integration.test.js', 'seed-cleanup-integration.test.js', 'seed-guestlists-integration.test.js', 'venue-selection-integration.test.js'];
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 2;

function discoverTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? discoverTests(filename) : entry.name.endsWith('.test.js') ? [filename] : [];
  }).sort();
}

function combineErrors(first, next) {
  if (!first) return next;
  if (first === next) return first;
  return new AggregateError([first, next], `${first.message}\n${next.message}`);
}

function isolatedEnvironment(databaseUrl, environment = process.env) {
  const url = assertLoopbackUrl(postgresUrl(databaseUrl));
  assertGeneratedDatabaseName(url.pathname.slice(1));
  return { ...offlineEnvironment(environment), DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, TEST_DATABASE_MANAGED: '1', DATABASE_SSL: environment.TEST_DATABASE_SSL === 'true' ? 'true' : 'false', RUN_DB_TESTS: '', RUN_ORLANDO_SEED_TESTS: '' };
}

async function runBounded(items, concurrency, operation, onFailure = async () => {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error(`Test concurrency must be an integer from 1 to ${MAX_CONCURRENCY}.`);
  let index = 0;
  let failure = null;
  async function worker() {
    while (!failure && index < items.length) {
      const item = items[index++];
      try { await operation(item); }
      catch (error) {
        const firstFailure = !failure;
        failure = combineErrors(failure, error);
        if (firstFailure) {
          try { await onFailure(error); }
          catch (shutdownError) { failure = combineErrors(failure, shutdownError); }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure;
}

async function runIntegrationSuites(suites, dependencies = {}) {
  for (const filename of suites) if (!INTEGRATION_TESTS.includes(filename)) throw new Error(`Unknown required integration suite: ${filename}`);
  if (!suites.length || new Set(suites).size !== suites.length) throw new Error('Required integration suites must be selected once each.');
  const timing = dependencies.timing || createTimingCollector('api');
  const supervisor = dependencies.supervisor || createProcessSupervisor({ cwd: apiRoot });
  const environment = dependencies.environment || process.env;
  const log = dependencies.log || console.log;
  const migrationNames = fs.readdirSync(path.join(apiRoot, 'src/db/migrations')).filter((name) => /^(?!.*\.d\.ts$).*\.(cjs|js|cts|ts)$/.test(name)).sort();
  const databases = createTemplateDatabaseManager({ ...dependencies, environment, supervisor, timing, migrationNames, log });
  let failure = null;
  try {
    await databases.prepare((url, scope) => supervisor.run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:migrate', '--', '--env', 'test'], isolatedEnvironment(url, environment), { scope }));
    await runBounded(suites, dependencies.concurrency ?? DEFAULT_CONCURRENCY, async (filename) => {
      await timing.measure('integration-suite', async () => {
        let database;
        let suiteFailure = null;
        try {
          database = await databases.clone(filename);
          log(`\nIsolated PostgreSQL integration: ${filename}`);
          await timing.measure('integration-tests', () => supervisor.run(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', path.join(apiRoot, 'test', filename)], isolatedEnvironment(database.url, environment), { requireExecutedTests: true, scope: database.name }), { suite: filename });
        } catch (error) {
          suiteFailure = error;
          try { await supervisor.stop(error); }
          catch (shutdownError) { suiteFailure = combineErrors(suiteFailure, shutdownError); }
        } finally {
          if (database) {
            try { await databases.drop(database.name, { suite: filename, role: 'integration' }); }
            catch (cleanupError) { suiteFailure = combineErrors(suiteFailure, cleanupError); }
          }
        }
        if (suiteFailure) throw suiteFailure;
      }, { suite: filename });
    }, (error) => supervisor.stop(error));
  } catch (error) {
    failure = error;
    try { await supervisor.stop(error); }
    catch (shutdownError) { failure = combineErrors(failure, shutdownError); }
  } finally {
    try { await databases.cleanup(); }
    catch (cleanupError) { failure = combineErrors(failure, cleanupError); }
    if (!dependencies.timing) timing.report();
  }
  if (failure) throw failure;
}

async function runIntegration(filename, dependencies = {}) {
  if (!INTEGRATION_TESTS.includes(filename)) throw new Error(`Unknown required integration suite: ${filename}`);
  return runIntegrationSuites([filename], dependencies);
}

async function runDemoTests({ environment = process.env, supervisor = createProcessSupervisor({ cwd: apiRoot }) } = {}) {
  if (!environment.DEMO_TEST_DATABASE_URL) throw new Error('Demo-only tests require an explicitly prepared DEMO_TEST_DATABASE_URL. They are excluded from npm test and never migrate or seed a database automatically.');
  const url = assertLoopbackUrl(postgresUrl(environment.DEMO_TEST_DATABASE_URL));
  if (!/^nitewide_demo_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))) throw new Error('DEMO_TEST_DATABASE_URL must select a dedicated nitewide_demo_test database. Existing development and production databases are not demo test targets.');
  await supervisor.run(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...DEMO_TESTS.map((filename) => path.join(apiRoot, 'test', filename))], { ...offlineEnvironment(environment), DATABASE_URL: url.toString(), TEST_DATABASE_URL: '', TEST_DATABASE_MANAGED: '', RUN_DB_TESTS: '1', RUN_ORLANDO_SEED_TESTS: '1' }, { requireExecutedTests: true });
}

function parseOptions(args = []) {
  let mode = 'all'; let suite = null; let concurrency = DEFAULT_CONCURRENCY; let concurrencySelected = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--unit', '--integration', '--demo'].includes(argument)) {
      if (mode !== 'all') throw new Error('Choose only one test mode: --unit, --integration, or --demo.');
      mode = argument.slice(2);
    } else if (argument === '--suite') {
      if (suite !== null) throw new Error('Choose only one integration suite.');
      suite = args[++index];
      if (!INTEGRATION_TESTS.includes(suite)) throw new Error('Pass --suite followed by a required integration test filename.');
    } else if (argument === '--concurrency') {
      if (concurrencySelected) throw new Error('Choose test concurrency only once.');
      const value = args[++index];
      if (typeof value !== 'string' || !/^[12]$/.test(value)) throw new Error(`Pass --concurrency followed by an integer from 1 to ${MAX_CONCURRENCY}.`);
      concurrency = Number(value);
      concurrencySelected = true;
    } else throw new Error(`Unknown test option: ${argument}`);
  }
  if (suite && !['all', 'integration'].includes(mode)) throw new Error('--suite can only select an integration test.');
  if (concurrencySelected && !['all', 'integration'].includes(mode)) throw new Error('--concurrency can only configure integration tests.');
  return { mode: suite ? 'integration' : mode, suites: suite ? [suite] : [...INTEGRATION_TESTS], concurrency };
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const timing = dependencies.timing || createTimingCollector('api');
  const supervisor = dependencies.supervisor || createProcessSupervisor({ cwd: apiRoot });
  const environment = dependencies.environment || process.env;
  let interrupted = null;
  const signals = ['SIGINT', 'SIGTERM'];
  function interrupt(signal) {
    if (interrupted) supervisor.forceStop();
    interrupted ||= signal;
    supervisor.stop(signal).catch((error) => console.error(error.message));
  }
  const handlers = signals.map((signal) => () => interrupt(signal));
  if (dependencies.handleSignals) signals.forEach((signal, index) => process.on(signal, handlers[index]));
  try {
    await timing.measure('total', async () => {
      const { mode, suites, concurrency } = parseOptions(args);
      if (mode === 'demo') return timing.measure('demo-tests', () => runDemoTests({ environment, supervisor }), { role: 'demo' });
      for (const filename of INTEGRATION_TESTS) if (!fs.existsSync(path.join(apiRoot, 'test', filename))) throw new Error(`Required standard integration test is missing: ${filename}`);
      const discovered = [...discoverTests(path.join(apiRoot, 'test')), ...discoverTests(path.join(apiRoot, 'email-tests'))];
      const classified = new Set([...INTEGRATION_TESTS, ...DEMO_TESTS]);
      for (const filename of discovered) if (filename.endsWith('-integration.test.js') && !classified.has(path.basename(filename))) throw new Error(`An integration suite is not classified for mandatory or demo execution: ${path.basename(filename)}`);
      const excluded = new Set([...INTEGRATION_TESTS, ...DEMO_TESTS].map((filename) => path.join(apiRoot, 'test', filename)));
      const unitTests = discovered.filter((filename) => !excluded.has(filename));
      if (!unitTests.length) throw new Error('Required API unit test discovery produced no tests.');
      if (mode !== 'integration') await timing.measure('unit-tests', () => supervisor.run(process.execPath, ['--test', '--test-reporter=tap', ...unitTests], { ...offlineEnvironment(environment), DATABASE_URL: 'postgres://test:test@127.0.0.1:1/nitewide_unit_no_database', TEST_DATABASE_URL: '', TEST_DATABASE_MANAGED: '', RUN_DB_TESTS: '', RUN_ORLANDO_SEED_TESTS: '' }, { requireExecutedTests: true }), { role: 'unit' });
      if (mode !== 'unit') await runIntegrationSuites(suites, { ...dependencies, concurrency, timing, supervisor, environment });
      if (supervisor.stopped) throw new Error('Test run interrupted.');
    });
  } catch (error) {
    try { await supervisor.stop(error); }
    catch (shutdownError) { error = combineErrors(error, shutdownError); }
    if (interrupted) error.exitCode = interrupted === 'SIGINT' ? 130 : 143;
    throw error;
  } finally {
    if (dependencies.handleSignals) signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
    timing.report();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), { handleSignals: true }).catch((error) => { console.error(error.message); process.exitCode = error.exitCode || 1; });
}

module.exports = { INTEGRATION_TESTS, DEMO_TESTS, DEFAULT_CONCURRENCY, MAX_CONCURRENCY, discoverTests, isolatedEnvironment, parseOptions, runBounded, runIntegration, runIntegrationSuites, runDemoTests, main };
