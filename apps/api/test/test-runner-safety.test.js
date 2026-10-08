const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertManagedTestDatabase, assertGeneratedDatabaseName, assertLoopbackUrl, maintenanceUrl, offlineEnvironment } = require('../scripts/test-database.cjs');
const { INTEGRATION_TESTS, DEMO_TESTS, discoverTests, isolatedEnvironment, parseOptions, runIntegration } = require('../scripts/run-tests.cjs');

const suffix = '0123456789abcdef0123456789abcdef';
const dbUrl = `postgres://test:test@127.0.0.1:5433/nitewide_test_${suffix}`;

test('focused Node runner modes preserve mandatory defaults and reject ambiguous options', () => {
  assert.deepEqual(parseOptions(), { mode: 'all', suites: INTEGRATION_TESTS, concurrency: 2 });
  assert.equal(parseOptions(['--unit']).mode, 'unit');
  assert.equal(parseOptions(['--integration']).mode, 'integration');
  assert.equal(parseOptions(['--demo']).mode, 'demo');
  const suite = INTEGRATION_TESTS[0];
  assert.deepEqual(parseOptions(['--integration', '--suite', suite]), { mode: 'integration', suites: [suite], concurrency: 2 });
  assert.deepEqual(parseOptions(['--suite', suite]), { mode: 'integration', suites: [suite], concurrency: 2 });
  assert.equal(parseOptions(['--integration', '--concurrency', '1']).concurrency, 1);
  assert.equal(parseOptions(['--concurrency', '2']).concurrency, 2);
  for (const args of [['--unit', '--integration'], ['--unit', '--suite', suite], ['--demo', '--suite', suite], ['--suite'], ['--suite', '../src/server.js'], ['--suite', DEMO_TESTS[0]], ['--suite', suite, '--suite', suite], ['--live']]) {
    assert.throws(() => parseOptions(args), Error, JSON.stringify(args));
  }
  for (const value of [undefined, '', '0', '3', '-1', '1.0', '01', '2x', 'Infinity', 'NaN', ' 2', '2 ']) {
    assert.throws(() => parseOptions(['--concurrency', ...(value === undefined ? [] : [value])]), /integer from 1 to 2/);
  }
  assert.throws(() => parseOptions(['--concurrency', '1', '--concurrency', '2']), /only once/);
  assert.throws(() => parseOptions(['--unit', '--concurrency', '2']), /only configure integration/);
  assert.throws(() => parseOptions(['--demo', '--concurrency', '2']), /only configure integration/);
});

test('integration entry point rejects unknown files before connecting to PostgreSQL', async () => {
  await assert.rejects(runIntegration('../src/server.js'), /Unknown required integration suite/);
});

test('managed integration DB guard requires test mode, exact generated DB URL and marker', () => {
  const valid = { NODE_ENV: 'test', TEST_DATABASE_MANAGED: '1', TEST_DATABASE_URL: dbUrl, DATABASE_URL: dbUrl };
  assert.equal(assertManagedTestDatabase({ ...valid }), dbUrl);
  assert.throws(() => assertManagedTestDatabase({ ...valid, TEST_DATABASE_MANAGED: '' }), /managed isolated database/i);
  assert.throws(() => assertManagedTestDatabase({ ...valid, NODE_ENV: 'production' }), /managed isolated database/i);
  assert.throws(() => assertManagedTestDatabase({ ...valid, DATABASE_URL: 'postgres://test:test@127.0.0.1:5433/nitewide' }), /exactly match/i);
  assert.throws(() => assertManagedTestDatabase({ ...valid, TEST_DATABASE_URL: 'postgres://test:test@127.0.0.1:5433/nitewide' }), /generated nitewide_test namespace/i);
  assert.throws(() => assertManagedTestDatabase({ ...valid, TEST_DATABASE_URL: `postgres://test:test@db.example:5433/nitewide_test_${suffix}`, DATABASE_URL: `postgres://test:test@db.example:5433/nitewide_test_${suffix}` }), /loopback/i);
  assert.throws(() => assertGeneratedDatabaseName('nitewide'), /generated nitewide_test namespace/i);
});

test('maintenance DB URL is local-only and points to postgres rather than an application database', () => {
  assert.equal(new URL(maintenanceUrl({ TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/postgres' })).pathname, '/postgres');
  assert.throws(() => maintenanceUrl({ TEST_DATABASE_ADMIN_URL: 'postgres://test:test@db.example:5432/postgres' }), /loopback/i);
  assert.throws(() => maintenanceUrl({ TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/nitewide' }), /maintenance database/i);
  assert.throws(() => maintenanceUrl({ TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/postgres?host=remote.example' }), /connection options/i);
  assert.throws(() => maintenanceUrl({ TEST_DATABASE_ADMIN_URL: 'postgres://test:test@127.0.0.1:5433/postgres?hostaddr=192.0.2.1' }), /connection options/i);
});

test('standard runner classifies the mandatory integrations and five demo-only suites exactly', () => {
  assert.deepEqual(INTEGRATION_TESTS, ['business-access-request-integration.test.js', 'abuse-session-integration.test.js', 'admissions-integration.test.js', 'business-integration.test.js', 'business-reporting-integration.test.js', 'business-read-integration.test.js', 'admin-onboarding-lifecycle-integration.test.js', 'admin-business-access-integration.test.js', 'admin-report-support-integration.test.js', 'venue-access-integration.test.js', 'public-discovery-integration.test.js', 'customer-experience-integration.test.js', 'referral-reactivation-integration.test.js', 'mutation-concurrency-integration.test.js', 'report-export-integration.test.js', 'notification-worker-integration.test.js', 'email-worker-integration.test.js', 'media-storage-integration.test.js', 'production-diagnostics-integration.test.js', 'api-domain-contract-integration.test.js', 'password-change-integration.test.js', 'payment-safety-integration.test.js', 'stripe-checkout-integration.test.js', 'business-payment-account-integration.test.js','business-payment-disconnect-integration.test.js','guestlist-passes-integration.test.js', 'customer-my-events-integration.test.js', 'customer-rundown-integration.test.js', 'guestlist-quantity-integration.test.js', 'commission-ledger-integration.test.js','commission-payment-integration.test.js','organizer-messages-integration.test.js','support-messages-integration.test.js','payment-preflight-integration.test.js']);
  assert.deepEqual(DEMO_TESTS, ['orlando-seed-integration.test.js', 'posh-importer-integration.test.js', 'seed-cleanup-integration.test.js', 'seed-guestlists-integration.test.js', 'venue-selection-integration.test.js']);
  const discovered = discoverTests(path.resolve(__dirname));
  for (const filename of [...INTEGRATION_TESTS, ...DEMO_TESTS]) assert.ok(discovered.some((item) => path.basename(item) === filename), `${filename} must be classified`);
  for (const filename of INTEGRATION_TESTS) assert.ok(!DEMO_TESTS.includes(filename));
});

test('runner child environment blanks every Resend setting and marks only generated test DB targets', () => {
  const incoming = { RESEND_API_KEY: 'secret', RESEND_FROM_EMAIL: 'secret', RESEND_EXTRA: 'secret', DATABASE_URL: 'ignored', NODE_ENV: 'production', LOCATION_GEOCODING_PROVIDER: 'census' };
  const offline = offlineEnvironment(incoming);
  assert.equal(offline.RESEND_API_KEY, '');
  assert.equal(offline.RESEND_FROM_EMAIL, '');
  assert.equal(offline.RESEND_EXTRA, '');
  assert.equal(offline.RESEND_TEST_READ_API_KEY, '');
  assert.equal(offline.RESEND_TEST_MODE, 'false');
  assert.equal(offline.NODE_ENV, 'test');
  assert.equal(offline.LOG_LEVEL, 'silent');
  assert.equal(offline.LOCATION_GEOCODING_PROVIDER, 'disabled', 'test runners never inherit an external geocoder');
  assert.equal(offlineEnvironment({}).LOCATION_GEOCODING_PROVIDER, 'disabled', 'dotenv cannot restore an ambient provider');
  assert.equal(offlineEnvironment({ LOG_LEVEL: 'info' }).LOG_LEVEL, 'info');
  const child = isolatedEnvironment(dbUrl);
  assert.equal(child.TEST_DATABASE_MANAGED, '1');
  assert.equal(child.TEST_DATABASE_URL, dbUrl);
  assert.equal(child.DATABASE_URL, dbUrl);
  assert.equal(child.RUN_DB_TESTS, '');
  assert.throws(() => isolatedEnvironment('postgres://test:test@127.0.0.1:5433/nitewide'), /generated nitewide_test namespace/);
  assert.throws(() => isolatedEnvironment(`postgres://test:test@db.example:5433/nitewide_test_${suffix}`), /loopback/);
});

test('routing overrides are rejected case-insensitively even with encoded names or duplicate options', () => {
  const base = 'postgres://test:test@127.0.0.1:5433/postgres';
  for (const key of ['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'servicefile']) {
    for (const encoded of [key.toUpperCase(), `%${key.charCodeAt(0).toString(16)}${key.slice(1)}`]) {
      const target = `${base}?application_name=offline-audit&${encoded}=remote-target&application_name=duplicate`;
      assert.throws(() => assertLoopbackUrl(new URL(target)), /connection options/);
      assert.throws(() => maintenanceUrl({ TEST_DATABASE_ADMIN_URL: target }), /connection options/);
    }
  }
  assert.equal(assertLoopbackUrl(new URL(`${base}?application_name=offline-audit&sslmode=disable`)).hostname, '127.0.0.1');
});
