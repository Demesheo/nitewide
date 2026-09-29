const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertManagedTestDatabase, assertGeneratedDatabaseName, maintenanceUrl, offlineEnvironment } = require('../scripts/test-database.cjs');
const { INTEGRATION_TESTS, DEMO_TESTS, discoverTests, isolatedEnvironment } = require('../scripts/run-tests.cjs');

const suffix = '0123456789abcdef0123456789abcdef';
const dbUrl = `postgres://test:test@127.0.0.1:5433/nitewide_test_${suffix}`;

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
});

test('standard runner classifies the six mandatory integrations and five demo-only suites exactly', () => {
  assert.deepEqual(INTEGRATION_TESTS, ['admissions-integration.test.js', 'business-integration.test.js', 'business-reporting-integration.test.js', 'admin-onboarding-lifecycle-integration.test.js', 'public-discovery-integration.test.js', 'customer-experience-integration.test.js']);
  assert.deepEqual(DEMO_TESTS, ['orlando-seed-integration.test.js', 'posh-importer-integration.test.js', 'seed-cleanup-integration.test.js', 'seed-guestlists-integration.test.js', 'venue-selection-integration.test.js']);
  const discovered = discoverTests(path.resolve(__dirname));
  for (const filename of [...INTEGRATION_TESTS, ...DEMO_TESTS]) assert.ok(discovered.some((item) => path.basename(item) === filename), `${filename} must be classified`);
  for (const filename of INTEGRATION_TESTS) assert.ok(!DEMO_TESTS.includes(filename));
});

test('runner child environment blanks every Resend setting and marks only generated test DB targets', () => {
  const incoming = { RESEND_API_KEY: 'secret', RESEND_FROM_EMAIL: 'secret', RESEND_EXTRA: 'secret', DATABASE_URL: 'ignored', NODE_ENV: 'production' };
  const offline = offlineEnvironment(incoming);
  assert.equal(offline.RESEND_API_KEY, '');
  assert.equal(offline.RESEND_FROM_EMAIL, '');
  assert.equal(offline.RESEND_EXTRA, '');
  assert.equal(offline.RESEND_TEST_READ_API_KEY, '');
  assert.equal(offline.RESEND_TEST_MODE, 'false');
  assert.equal(offline.NODE_ENV, 'test');
  const child = isolatedEnvironment(dbUrl);
  assert.equal(child.TEST_DATABASE_MANAGED, '1');
  assert.equal(child.TEST_DATABASE_URL, dbUrl);
  assert.equal(child.DATABASE_URL, dbUrl);
  assert.equal(child.RUN_DB_TESTS, '');
});
