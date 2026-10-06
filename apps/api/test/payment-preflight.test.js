const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { QueryTypes, Transaction } = require('sequelize');
const { createApp } = require('../src/app');
const { DomainError } = require('../src/domain/errors');
const {
  createPaymentPreflight, inspectPaymentPreflight, inspectPaymentConfiguration, requiredPaymentSchema, REQUIRED_MIGRATIONS, CHECK_MESSAGES,
} = require('../src/diagnostics/payment-preflight');
const { paymentPreflightReport } = require('../src/http/payment-preflight-schemas');

const observedAt = new Date('2026-10-04T12:00:00.000Z');
const config = {
  NODE_ENV: 'test', LOG_LEVEL: 'silent', STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_offlineprivate',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_offlinepublic', STRIPE_WEBHOOK_SECRET: 'whsec_offlinepayment',
  STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_offlineaccount', CUSTOMER_APP_URL: 'https://customer.nitewide.test',
  BUSINESS_APP_URL: 'https://business.nitewide.test/app', businessAppUrl: 'https://business.nitewide.test/app',
  corsOrigins: ['https://customer.nitewide.test', 'https://business.nitewide.test'],
  AUTH_TOKEN_SECRET: 'offline-test-auth-key-with-32-characters', RELEASE_REVISION: 'a'.repeat(40),
};
const stripe = { mode: 'test', enabled: true };
const hasCheck = (report, code, status) => report.checks.some(value => value.code === code && value.status === status);
const catalog = () => Object.entries(requiredPaymentSchema()).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name })));
const group = (changes = {}) => ({
  source: 'default', organization_active: true, account_present: true, account_owned: true, account_owner_active: true,
  api_v2: true, lifecycle_active: true, mode_test: true, stripe_present: true, details_submitted: true,
  charges_enabled: true, card_payments_active: true, controller_matches: true, disabled: false,
  disconnect_clear: true, freshness: 'current', event_count: 5, total_event_count: 5, ...changes,
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function databaseFixture({ columns = catalog(), migrations = REQUIRED_MIGRATIONS, groups = [group()], workers = { healthy_count: 1, matching_count: 1, mismatched_count: 0 }, beforeQuery, error } = {}) {
  const calls = [], transactions = [];
  const transaction = { privateMarker: 'offline-transaction' };
  const sequelize = {
    transaction: async (options, fn) => { transactions.push(options); return fn(transaction); },
    query: async (sql, options) => {
      calls.push({ sql, options });
      if (beforeQuery) await beforeQuery(sql);
      if (error) throw error;
      if (sql.startsWith('SET ')) return [];
      if (sql.includes('information_schema.columns')) return columns;
      if (/SELECT name FROM/.test(sql)) return migrations.map(name => ({ name }));
      if (sql.startsWith('WITH routes AS')) return groups;
      if (sql.includes('FROM background_workers')) return [workers];
      throw new Error('Unexpected query in offline preflight fixture');
    },
  };
  return { sequelize, calls, transactions, transaction };
}
const dependencies = (fixture, changes = {}) => ({ config, sequelize: fixture.sequelize, stripe, now: () => observedAt, ...changes });

test('disabled payment diagnostics skip database and provider operations while strict paid inspection fails closed', async () => {
  const fixture = databaseFixture();
  const service = createPaymentPreflight(dependencies(fixture, { config: { ...config, STRIPE_MODE: 'disabled' }, stripe: null }));
  const normal = await service.inspect();
  assert.equal(normal.mode, 'disabled');
  assert.equal(normal.schema.status, 'not-checked');
  assert.equal(normal.routing.status, 'not-checked');
  const strict = await service.inspect({ requirePaid: true });
  assert.equal(strict.mode, 'configuration-blocked');
  assert.ok(hasCheck(strict, 'PAYMENTS_DISABLED', 'fail'));
  assert.equal(fixture.transactions.length, 0);
  assert.equal(fixture.calls.length, 0);
});

test('missing, malformed and live credentials report fixed failures without echoing configured values', () => {
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET']) {
    for (const value of [undefined, '', 'private value with spaces', 'bad_value/secret']) {
      const report = inspectPaymentConfiguration({ ...config, [name]: value });
      assert.equal(report.mode, 'configuration-blocked');
      assert.ok(hasCheck(report, `${name}_${value ? 'INVALID' : 'MISSING'}`, 'fail'));
      if (value) assert.ok(!JSON.stringify(report).includes(value));
    }
  }
  for (const changes of [{ STRIPE_MODE: 'live' }, { STRIPE_SECRET_KEY: 'sk_live_offlinefixture' },
    { STRIPE_PUBLISHABLE_KEY: 'pk_live_offlinefixture' }, { STRIPE_MODE: 'disabled', STRIPE_SECRET_KEY: 'sk_live_offlinefixture' }]) {
    const report = inspectPaymentConfiguration({ ...config, ...changes });
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'LIVE_PAYMENTS_UNSUPPORTED', 'fail'));
  }
  for (const STRIPE_MODE of ['unknown', 'Test', 'false']) assert.ok(hasCheck(inspectPaymentConfiguration({ ...config, STRIPE_MODE }), 'STRIPE_MODE_INVALID', 'fail'));
  const sharedSecrets = inspectPaymentConfiguration({ ...config, STRIPE_ACCOUNT_WEBHOOK_SECRET: config.STRIPE_WEBHOOK_SECRET });
  assert.ok(hasCheck(sharedSecrets, 'STRIPE_WEBHOOK_SECRETS_NOT_DISTINCT', 'fail'));
  assert.equal(inspectPaymentConfiguration(config).mode, 'sandbox-ready');
});

test('hosted callbacks require explicit public HTTPS origins without credentials, query, fragments or CORS drift', () => {
  const hosted = { ...config, NODE_ENV: 'production' };
  for (const name of ['CUSTOMER_APP_URL', 'BUSINESS_APP_URL']) {
    for (const value of [undefined, 'http://customer.nitewide.test', 'https://localhost', 'https://service.internal',
      'https://192.168.0.1/app', 'https://10.0.0.1', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001',
      'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://169.254.169.254', 'https://service.local.',
      'https://user:password@customer.nitewide.test', 'https://customer.nitewide.test?private=secret', 'https://customer.nitewide.test#secret']) {
      const report = inspectPaymentConfiguration({ ...hosted, [name]: value });
      assert.equal(report.mode, 'configuration-blocked', `${name}: ${value}`);
      assert.ok(hasCheck(report, name === 'CUSTOMER_APP_URL' ? 'CUSTOMER_CALLBACK_INVALID' : 'BUSINESS_CALLBACK_INVALID', 'fail'));
      if (value) assert.ok(!JSON.stringify(report).includes(value));
    }
  }
  assert.ok(hasCheck(inspectPaymentConfiguration({ ...hosted, corsOrigins: [] }), 'CALLBACK_CORS_MISMATCH', 'fail'));
  assert.equal(inspectPaymentConfiguration(hosted).mode, 'sandbox-ready');
  const demo = { ...hosted, hostedDemo: true, CUSTOMER_APP_URL: 'https://demo.nitewide.test',
    BUSINESS_APP_URL: 'https://demo.nitewide.test/app', corsOrigins: ['https://demo.nitewide.test'] };
  assert.equal(inspectPaymentConfiguration(demo).mode, 'sandbox-ready');
  assert.equal(inspectPaymentConfiguration({ ...demo, BUSINESS_APP_URL: 'https://demo.nitewide.test/app/' }).mode, 'sandbox-ready');
  for (const changes of [{ CUSTOMER_APP_URL: 'https://demo.nitewide.test/wrong-customer' },
    { BUSINESS_APP_URL: 'https://demo.nitewide.test/app/sign-in' },
    { BUSINESS_APP_URL: 'https://business.nitewide.test/app', corsOrigins: ['https://demo.nitewide.test', 'https://business.nitewide.test'] }]) {
    const report = inspectPaymentConfiguration({ ...demo, ...changes });
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'HOSTED_DEMO_CALLBACK_ROUTING_MISMATCH', 'fail'));
  }
  assert.equal(inspectPaymentConfiguration({ ...config, CUSTOMER_APP_URL: 'http://localhost:5173', BUSINESS_APP_URL: 'http://localhost:5174/app' }).mode, 'sandbox-ready');
  const separate = { ...hosted, hostedDemo: true, APP_ROUTING_MODE: 'subdomains', ADMIN_APP_URL: 'https://admin.nitewide.test',
    corsOrigins: [...config.corsOrigins, 'https://admin.nitewide.test'] };
  assert.equal(inspectPaymentConfiguration(separate).mode, 'sandbox-ready');
  for (const invalid of [{ ADMIN_APP_URL: undefined }, { ADMIN_APP_URL: separate.CUSTOMER_APP_URL }, { corsOrigins: config.corsOrigins }]) {
    const report = inspectPaymentConfiguration({ ...separate, ...invalid });
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'APP_ROUTING_INVALID', 'fail'));
    assert.doesNotMatch(JSON.stringify(report), /admin\.nitewide\.test/);
  }
});

test('shared merchant routing is an explicit sandbox warning and fails closed outside permitted runtimes', () => {
  const shared = { ...config, STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_offlineshared' };
  for (const changes of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'production', hostedDemo: true,
    CUSTOMER_APP_URL: 'https://demo.nitewide.test', BUSINESS_APP_URL: 'https://demo.nitewide.test/app', corsOrigins: ['https://demo.nitewide.test'] }]) {
    const report = inspectPaymentConfiguration({ ...shared, ...changes });
    assert.equal(report.mode, 'sandbox-ready');
    assert.ok(hasCheck(report, 'SHARED_SANDBOX_ROUTING', 'warn'));
  }
  for (const changes of [{ NODE_ENV: 'production' }, { NODE_ENV: 'staging' }, { STRIPE_MODE: 'disabled' },
    { STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_invalid/route' }, { STRIPE_SECRET_KEY: 'sk_live_offline' }]) {
    const report = inspectPaymentConfiguration({ ...shared, ...changes });
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'SHARED_SANDBOX_ROUTING_FORBIDDEN', 'fail'));
  }
});

test('successful diagnostics use one bounded read-only snapshot, aggregate routes and preserve unverified evidence', async () => {
  const fixture = databaseFixture();
  const report = await inspectPaymentPreflight(dependencies(fixture, { timeoutMs: 1500 }));
  paymentPreflightReport.parse(report);
  assert.equal(report.mode, 'sandbox-ready');
  assert.equal(report.checkedAt, observedAt.toISOString());
  assert.deepEqual(report.evidence, { keyPairIdentity: 'not-verified', webhookDelivery: 'not-verified', providerReadiness: 'stored-snapshot-only' });
  assert.equal(report.routing.readyEventCount, 5);
  assert.equal(report.routing.blockedEventCount, 0);
  assert.equal(fixture.transactions.length, 1);
  assert.equal(fixture.transactions[0].readOnly, true);
  assert.equal(fixture.transactions[0].isolationLevel, Transaction.ISOLATION_LEVELS.REPEATABLE_READ);
  assert.match(fixture.calls[0].sql, /^SET TRANSACTION READ ONLY/);
  assert.match(fixture.calls[0].sql, /SET LOCAL statement_timeout = 1500/);
  assert.match(fixture.calls[0].sql, /SET LOCAL lock_timeout = 1000/);
  assert.equal(fixture.calls.length, 5, 'Statement setup, catalog, ledger, route aggregate and worker aggregate only');
  for (const call of fixture.calls) {
    assert.equal(call.options.transaction, fixture.transaction);
    assert.equal(call.options.logging, false);
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
    if (!call.sql.startsWith('SET ')) assert.equal(call.options.type, QueryTypes.SELECT);
  }
  assert.match(fixture.calls.find(call => call.sql.startsWith('WITH routes AS')).sql, /LIMIT 129/);
  for (const value of Object.values(config).filter(value => typeof value === 'string' && value !== config.RELEASE_REVISION && value.length > 10)) {
    assert.ok(!JSON.stringify(report).includes(value), `Report must not reveal ${value}`);
  }
});

test('missing schema or ledger entries skip routing and suppress raw database exception messages', async () => {
  for (const input of [{ columns: [] }, { columns: catalog().filter(column => column.column_name !== 'controller_matches') },
    { migrations: REQUIRED_MIGRATIONS.slice(1) }]) {
    const fixture = databaseFixture(input);
    const report = await inspectPaymentPreflight(dependencies(fixture));
    assert.equal(report.schema.status, 'blocked');
    assert.equal(report.routing.status, 'not-checked');
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'PAYMENT_SCHEMA_MISSING', 'fail'));
    assert.ok(!fixture.calls.some(call => call.sql.startsWith('WITH routes AS')));
  }
  const privateError = new Error('postgres://privateuser:privatepass@database.test acct_private sk_test_private whsec_private');
  privateError.original = { code: '57014', sql: 'SELECT secret FROM private_table' };
  const report = await inspectPaymentPreflight(dependencies(databaseFixture({ error: privateError })));
  assert.equal(report.schema.status, 'unavailable');
  assert.equal(report.mode, 'configuration-blocked');
  assert.ok(hasCheck(report, 'PAYMENT_DATABASE_UNAVAILABLE', 'fail'));
  assert.doesNotMatch(JSON.stringify(report), /privateuser|privatepass|acct_private|sk_test_private|whsec_private|private_table|57014/);
  for (const check of report.checks) assert.equal(check.message, CHECK_MESSAGES[check.code]);
});

test('provider runtime mismatches and unresolved normalized merchant facts cannot claim sandbox readiness', async () => {
  for (const runtime of [null, { mode: 'live', enabled: true }, { mode: 'test', enabled: false },
    { mode: 'test', enabled: true, sandboxSharedAccountId: 'acct_unexpected' }]) {
    const report = await inspectPaymentPreflight(dependencies(databaseFixture(), { stripe: runtime }));
    assert.ok(hasCheck(report, 'PAYMENT_RUNTIME_UNAVAILABLE', 'fail'));
    assert.equal(report.mode, 'configuration-blocked');
  }
  const sharedMismatch = await inspectPaymentPreflight(dependencies(databaseFixture(), {
    config: { ...config, STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_configuredshared' },
  }));
  assert.ok(hasCheck(sharedMismatch, 'PAYMENT_RUNTIME_UNAVAILABLE', 'fail'));
  for (const changes of [{ organization_active: false }, { account_present: false }, { account_owned: false }, { account_owner_active: false },
    { api_v2: false }, { lifecycle_active: false }, { mode_test: false }, { stripe_present: false }, { details_submitted: false },
    { charges_enabled: false }, { card_payments_active: false }, { controller_matches: false }, { disabled: true },
    { disconnect_clear: false }, { freshness: 'missing' }, { freshness: 'stale' }, { freshness: 'future' }]) {
    const report = await inspectPaymentPreflight(dependencies(databaseFixture({ groups: [group(changes)] })));
    assert.equal(report.mode, 'configuration-blocked', JSON.stringify(changes));
    assert.equal(report.routing.readyEventCount, 0);
    assert.equal(report.routing.blockedEventCount, 5);
  }
});

test('complex routing groups hit the fixed diagnostic ceiling without processing an unbounded response', async () => {
  const report = await inspectPaymentPreflight(dependencies(databaseFixture({ groups: Array.from({ length: 129 }, () => group({ event_count: 1, total_event_count: 129 })) })));
  assert.equal(report.routing.status, 'unavailable');
  assert.equal(report.routing.activePaidEventCount, 129);
  assert.equal(report.mode, 'configuration-blocked');
  assert.ok(hasCheck(report, 'PAYMENT_ROUTING_COMPLEXITY_LIMIT', 'fail'));
});

test('worker report distinguishes matching, missing and drifting runtimes and bounds heartbeat freshness', async () => {
  const cases = [
    { workers: { healthy_count: 1, matching_count: 1, mismatched_count: 0 }, status: 'ready', code: 'WORKER_RUNTIME_READY' },
    { workers: { healthy_count: 0, matching_count: 0, mismatched_count: 0 }, status: 'blocked', code: 'WORKER_RUNTIME_MISSING' },
    { workers: { healthy_count: 1, matching_count: 0, mismatched_count: 1 }, status: 'blocked', code: 'WORKER_RUNTIME_MISMATCH' },
    { workers: { healthy_count: 2, matching_count: 1, mismatched_count: 1 }, status: 'blocked', code: 'WORKER_RUNTIME_MISMATCH' },
  ];
  for (const item of cases) {
    for (const NODE_ENV of ['test', 'production']) {
      const fixture = databaseFixture({ workers: item.workers });
      const report = await inspectPaymentPreflight(dependencies(fixture, { config: { ...config, NODE_ENV } }));
      assert.equal(report.workers.status, item.status);
      assert.deepEqual([report.workers.healthyWorkerCount, report.workers.matchingWorkerCount, report.workers.mismatchedWorkerCount],
        [item.workers.healthy_count, item.workers.matching_count, item.workers.mismatched_count]);
      const expectedCheck = item.status === 'ready' ? 'pass' : NODE_ENV === 'production' || item.workers.mismatched_count ? 'fail' : 'warn';
      assert.ok(hasCheck(report, item.code, expectedCheck));
      assert.equal(report.mode, expectedCheck === 'fail' ? 'configuration-blocked' : 'sandbox-ready');
      const sql = fixture.calls.find(call => call.sql.includes('FROM background_workers')).sql;
      assert.match(sql, /WHERE status='running'/);
      assert.match(sql, /heartbeat_at>CAST\(:observedAt AS timestamptz\)-INTERVAL '2 minutes'/);
      assert.match(sql, /heartbeat_at<=CAST\(:observedAt AS timestamptz\)/);
      assert.match(sql, /paymentReconciliationEnabled/);
      assert.match(sql, /configurationFingerprint/);
    }
  }
});

test('a strict paid gate requires worker evidence even locally; unknown release evidence blocks hosted readiness', async () => {
  const noWorker = { healthy_count: 0, matching_count: 0, mismatched_count: 0 };
  const local = { ...config, RELEASE_REVISION: undefined };
  const service = createPaymentPreflight(dependencies(databaseFixture({ workers: noWorker }), { config: local }));
  const [ordinary, strict] = await Promise.all([service.inspect(), service.inspect({ requirePaid: true })]);
  assert.equal(ordinary.mode, 'sandbox-ready');
  assert.ok(hasCheck(ordinary, 'RELEASE_REVISION_UNKNOWN', 'warn'));
  assert.ok(hasCheck(ordinary, 'WORKER_RUNTIME_MISSING', 'warn'));
  assert.equal(strict.mode, 'configuration-blocked');
  assert.ok(hasCheck(strict, 'WORKER_RUNTIME_MISSING', 'fail'));
  const directStrict = await inspectPaymentPreflight(dependencies(databaseFixture({ workers: noWorker })), { requirePaid: true });
  assert.equal(directStrict.mode, 'configuration-blocked');
  assert.ok(hasCheck(directStrict, 'WORKER_RUNTIME_MISSING', 'fail'));
  const hosted = await inspectPaymentPreflight(dependencies(databaseFixture({ workers: noWorker }), { config: { ...local, NODE_ENV: 'production' } }));
  assert.equal(hosted.mode, 'configuration-blocked');
  assert.ok(hasCheck(hosted, 'RELEASE_REVISION_UNKNOWN', 'fail'));
  assert.ok(hasCheck(hosted, 'WORKER_RUNTIME_MISSING', 'fail'));
});

test('empty paid routes only block a strict paid check and request options do not contaminate shared observations', async () => {
  const fixture = databaseFixture({ groups: [] });
  const service = createPaymentPreflight(dependencies(fixture));
  const [ordinary, strict, wrongRelease] = await Promise.all([service.inspect(), service.inspect({ requirePaid: true }), service.inspect({ expectRevision: 'b'.repeat(40) })]);
  assert.equal(fixture.transactions.length, 1);
  assert.equal(ordinary.mode, 'sandbox-ready');
  assert.ok(hasCheck(ordinary, 'PAID_ROUTES_MISSING', 'warn'));
  assert.equal(strict.mode, 'configuration-blocked');
  assert.ok(hasCheck(strict, 'PAID_ROUTES_MISSING', 'fail'));
  assert.equal(wrongRelease.mode, 'configuration-blocked');
  assert.ok(hasCheck(wrongRelease, 'RELEASE_REVISION_MISMATCH', 'fail'));
  ordinary.routing.readyEventCount = 100;
  assert.equal(strict.routing.readyEventCount, 0, 'Each caller receives an independent report');
});

test('timed-out concurrent probes retain one in-flight database inspection and recover once it completes', { timeout: 2000 }, async () => {
  const hold = deferred(), started = deferred(), finished = deferred();
  let held = true;
  const fixture = databaseFixture({ beforeQuery: async sql => {
    if (held && sql.includes('information_schema.columns')) { started.resolve(); await hold.promise; }
  } });
  const transaction = fixture.sequelize.transaction;
  fixture.sequelize.transaction = async (options, fn) => { try { return await transaction(options, fn); } finally { finished.resolve(); } };
  const service = createPaymentPreflight(dependencies(fixture, { timeoutMs: 20 }));
  const first = service.inspect(), second = service.inspect({ requirePaid: true });
  await started.promise;
  const results = await Promise.all([first, second]);
  for (const report of results) {
    assert.equal(report.mode, 'configuration-blocked');
    assert.ok(hasCheck(report, 'PAYMENT_DIAGNOSTIC_TIMEOUT', 'fail'));
    paymentPreflightReport.parse(report);
  }
  assert.ok(hasCheck(await service.inspect(), 'PAYMENT_DIAGNOSTIC_TIMEOUT', 'fail'));
  assert.equal(fixture.transactions.length, 1, 'A request deadline must not release the database single-flight guard');
  held = false;
  hold.resolve();
  await finished.promise;
  await new Promise(resolve => setImmediate(resolve));
  const recovered = await service.inspect();
  assert.equal(recovered.mode, 'sandbox-ready');
  assert.equal(fixture.transactions.length, 2);
});

test('HTTP diagnostics authorize internal users before inspection and validate strict query options', async () => {
  const fixture = databaseFixture();
  let authorizedInspections = 0;
  const app = createApp({ sequelize: fixture.sequelize, models: {}, config, healthCheck: async () => {}, services: {
    stripe, email: { enabled: false },
    auth: { authenticate: async token => ({ id: token }) },
    abuse: { before: async () => {}, authenticated: async () => {} },
    permissions: { assertInternal: async id => { if (id !== 'internal-fixture') throw new DomainError('Internal access required', { code: 'FORBIDDEN', status: 403 }); authorizedInspections++; } },
  } });
  const path = '/api/admin/diagnostics/payments';
  await request(app).get(path).expect(401).expect('Cache-Control', 'no-store');
  await request(app).get(path).set('Authorization', 'Bearer ordinary-fixture').expect(403).expect('Cache-Control', 'no-store');
  assert.equal(fixture.transactions.length, 0);
  for (const query of [{ requirePaid: 'maybe' }, { expectRevision: 'short' }, { arbitrary: 'value' }, { requirePaid: ['true', 'false'] }]) {
    await request(app).get(path).query(query).set('Authorization', 'Bearer internal-fixture').expect(422).expect('Cache-Control', 'no-store');
  }
  assert.equal(fixture.transactions.length, 0);
  const response = await request(app).get(path).query({ requirePaid: 'true', expectRevision: config.RELEASE_REVISION }).set('Authorization', 'Bearer internal-fixture').expect(200).expect('Cache-Control', 'no-store');
  paymentPreflightReport.parse(response.body.data);
  assert.equal(response.body.data.mode, 'sandbox-ready');
  assert.ok(hasCheck(response.body.data, 'RELEASE_REVISION_MATCH', 'pass'));
  assert.ok(authorizedInspections >= 1);
  await request(app).post(path).set('Authorization', 'Bearer internal-fixture').expect(405).expect('Allow', /GET/);
});
