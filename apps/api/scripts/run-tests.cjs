#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { offlineEnvironment, maintenanceUrl, postgresUrl, assertLoopbackUrl, assertGeneratedDatabaseName } = require('./test-database.cjs');

const apiRoot = path.resolve(__dirname, '..');
const INTEGRATION_TESTS = ['abuse-session-integration.test.js', 'admissions-integration.test.js', 'business-integration.test.js', 'business-reporting-integration.test.js', 'business-read-integration.test.js', 'admin-onboarding-lifecycle-integration.test.js', 'admin-business-access-integration.test.js', 'admin-report-support-integration.test.js', 'venue-access-integration.test.js', 'public-discovery-integration.test.js', 'customer-experience-integration.test.js', 'referral-reactivation-integration.test.js', 'mutation-concurrency-integration.test.js', 'report-export-integration.test.js', 'notification-worker-integration.test.js', 'email-worker-integration.test.js', 'media-storage-integration.test.js', 'production-diagnostics-integration.test.js', 'api-domain-contract-integration.test.js'];
const DEMO_TESTS = ['orlando-seed-integration.test.js', 'posh-importer-integration.test.js', 'seed-cleanup-integration.test.js', 'seed-guestlists-integration.test.js', 'venue-selection-integration.test.js'];
let activeChild = null; let interrupted = null;

function discoverTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? discoverTests(filename) : entry.name.endsWith('.test.js') ? [filename] : [];
  }).sort();
}

function child(command, args, environment, requireExecutedTests = false) {
  if (interrupted) return Promise.reject(new Error('Test run interrupted.'));
  return new Promise((resolve, reject) => {
    activeChild = spawn(command, args, { cwd: apiRoot, stdio: requireExecutedTests ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: environment, detached: process.platform !== 'win32' });
    const processHandle = activeChild;
    let summary = '';
    if (requireExecutedTests) processHandle.stdout.on('data', (chunk) => { process.stdout.write(chunk); summary = (summary + chunk.toString()).slice(-16384); });
    processHandle.once('error', (error) => { if (activeChild === processHandle) activeChild = null; reject(error); });
    processHandle.once('close', (status, signal) => {
      if (activeChild === processHandle) activeChild = null;
      if (status === 0 && !interrupted) {
        if (requireExecutedTests) {
          const tests = summary.match(/^# tests (\d+)\s*$/m);
          const skipped = summary.match(/^# skipped (\d+)\s*$/m);
          if (!tests || Number(tests[1]) < 1 || !skipped || Number(skipped[1]) !== 0) return reject(new Error('A required integration suite did not execute its tests without skips. Standard database coverage cannot be optional.'));
        }
        resolve();
      }
      else reject(new Error(signal ? `Test command interrupted by ${signal}.` : `Test command exited with status ${status}.`));
    });
  });
}

function isolatedEnvironment(databaseUrl) {
  return { ...offlineEnvironment(), DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, TEST_DATABASE_MANAGED: '1', DATABASE_SSL: process.env.TEST_DATABASE_SSL === 'true' ? 'true' : 'false', RUN_DB_TESTS: '', RUN_ORLANDO_SEED_TESTS: '' };
}

async function runIntegration(filename) {
  if (!INTEGRATION_TESTS.includes(filename)) throw new Error(`Unknown required integration suite: ${filename}`);
  const name = assertGeneratedDatabaseName(`nitewide_test_${crypto.randomUUID().replaceAll('-', '')}`);
  const adminUrl = maintenanceUrl();
  const databaseUrl = postgresUrl(adminUrl); databaseUrl.pathname = `/${name}`;
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'nitewide-isolated-test-runner' });
  let created = false; let connected = false;
  try {
    await client.connect(); connected = true;
    if (interrupted) throw new Error('Test run interrupted.');
    await client.query(`CREATE DATABASE "${name}"`); created = true;
    console.log(`\nIsolated PostgreSQL integration: ${filename}`);
    const environment = isolatedEnvironment(databaseUrl.toString());
    await child(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:migrate', '--', '--env', 'test'], environment);
    await child(process.execPath, ['--test', '--test-reporter=tap', path.join(apiRoot, 'test', filename)], environment, true);
  } catch (error) {
    if (!connected || !created) throw new Error(`Cannot provision the isolated PostgreSQL test database (${error.code || 'configuration error'}). Start the local PostGIS service on port 5433 or set TEST_DATABASE_ADMIN_URL to a PostgreSQL/PostGIS server's postgres maintenance database with CREATE DATABASE permission. No application database was migrated or seeded.`);
    throw error;
  } finally {
    try {
      if (created) {
        assertGeneratedDatabaseName(name);
        await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        console.log(`Removed isolated test database ${name}.`);
      }
    } catch (error) {
      throw new Error(`Cleanup failed for isolated database ${name} (${error.code || 'connection error'}). Only this generated database requires cleanup.`);
    } finally {
      if (connected) await client.end();
    }
  }
}

async function runDemoTests() {
  if (!process.env.DEMO_TEST_DATABASE_URL) throw new Error('Demo-only tests require an explicitly prepared DEMO_TEST_DATABASE_URL. They are excluded from npm test and never migrate or seed a database automatically.');
  const url = assertLoopbackUrl(postgresUrl(process.env.DEMO_TEST_DATABASE_URL));
  if (!/^nitewide_demo_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))) throw new Error('DEMO_TEST_DATABASE_URL must select a dedicated nitewide_demo_test database. Existing development and production databases are not demo test targets.');
  await child(process.execPath, ['--test', '--test-concurrency=1', ...DEMO_TESTS.map((filename) => path.join(apiRoot, 'test', filename))], { ...offlineEnvironment(), DATABASE_URL: url.toString(), TEST_DATABASE_URL: '', TEST_DATABASE_MANAGED: '', RUN_DB_TESTS: '1', RUN_ORLANDO_SEED_TESTS: '1' });
}

function parseOptions(args = []) {
  let mode = 'all'; let suite = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--unit', '--integration', '--demo'].includes(argument)) {
      if (mode !== 'all') throw new Error('Choose only one test mode: --unit, --integration, or --demo.');
      mode = argument.slice(2);
    } else if (argument === '--suite') {
      if (suite !== null) throw new Error('Choose only one integration suite.');
      suite = args[++index];
      if (!INTEGRATION_TESTS.includes(suite)) throw new Error('Pass --suite followed by a required integration test filename.');
    } else throw new Error(`Unknown test option: ${argument}`);
  }
  if (suite && !['all', 'integration'].includes(mode)) throw new Error('--suite can only select an integration test.');
  return { mode: suite ? 'integration' : mode, suites: suite ? [suite] : [...INTEGRATION_TESTS] };
}

async function main(args = process.argv.slice(2)) {
  const { mode, suites } = parseOptions(args);
  if (mode === 'demo') return runDemoTests();
  for (const filename of INTEGRATION_TESTS) if (!fs.existsSync(path.join(apiRoot, 'test', filename))) throw new Error(`Required standard integration test is missing: ${filename}`);
  const excluded = new Set([...INTEGRATION_TESTS, ...DEMO_TESTS].map((filename) => path.join(apiRoot, 'test', filename)));
  const unitTests = [...discoverTests(path.join(apiRoot, 'test')), ...discoverTests(path.join(apiRoot, 'email-tests'))].filter((filename) => !excluded.has(filename));
  if (mode !== 'integration') await child(process.execPath, ['--test', ...unitTests], { ...offlineEnvironment(), DATABASE_URL: 'postgres://test:test@127.0.0.1:1/nitewide_unit_no_database', TEST_DATABASE_URL: '', TEST_DATABASE_MANAGED: '', RUN_DB_TESTS: '', RUN_ORLANDO_SEED_TESTS: '' });
  if (mode !== 'unit') for (const filename of suites) await runIntegration(filename);
}

if (require.main === module) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    interrupted = signal;
    if (!activeChild?.pid) return;
    try {
      if (process.platform === 'win32') activeChild.kill('SIGTERM');
      else process.kill(-activeChild.pid, 'SIGTERM');
    } catch (error) { if (error.code !== 'ESRCH') console.error('Could not stop the active test process group.'); }
  });
  main().catch((error) => { console.error(error.message); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1; });
}

module.exports = { INTEGRATION_TESTS, DEMO_TESTS, discoverTests, isolatedEnvironment, parseOptions, runIntegration, runDemoTests, main };
