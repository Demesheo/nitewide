const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseRevision, paymentRuntimeEvidence } = require('../src/diagnostics/payment-runtime');
const { createWorkerRuntime } = require('../src/background/runtime');

const revision = 'a'.repeat(40);
const config = { NODE_ENV: 'production', hostedDemo: true, RELEASE_REVISION: revision,
  AUTH_TOKEN_SECRET: 'private-auth-'.repeat(4), STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_private',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_private', STRIPE_WEBHOOK_SECRET: 'whsec_privatepayment',
  STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_privateaccount', STRIPE_CONNECT_CLIENT_ID: 'ca_private',
  CUSTOMER_APP_URL: 'https://example.com', businessAppUrl: 'https://example.com/app',
  corsOrigins: ['https://example.com', 'https://business.example.com'] };

test('payment runtime evidence detects configuration drift without returning settings or secrets', () => {
  const evidence = paymentRuntimeEvidence(config);
  assert.equal(evidence.revision, revision);
  assert.match(evidence.configurationFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(paymentRuntimeEvidence({ ...config, corsOrigins: [...config.corsOrigins].reverse() }), evidence);
  for (const key of ['AUTH_TOKEN_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
    'STRIPE_ACCOUNT_WEBHOOK_SECRET', 'STRIPE_CONNECT_CLIENT_ID', 'CUSTOMER_APP_URL', 'businessAppUrl', 'APP_ROUTING_MODE', 'ADMIN_APP_URL', 'STRIPE_MODE', 'NODE_ENV']) {
    assert.notEqual(paymentRuntimeEvidence({ ...config, [key]: 'different' }).configurationFingerprint, evidence.configurationFingerprint, key);
  }
  assert.notEqual(paymentRuntimeEvidence({ ...config, STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_private' }).configurationFingerprint, evidence.configurationFingerprint);
  assert.deepEqual(paymentRuntimeEvidence({ ...config, AUTH_TOKEN_SECRET: '' }), { revision, configurationFingerprint: null });
  assert.doesNotMatch(JSON.stringify(evidence), /private|example|sk_test|whsec|pk_test/);
});

test('baked release identity overrides native environment and corrupt metadata never supplies a revision', () => {
  const env = { RENDER_GIT_COMMIT: 'b'.repeat(40) };
  assert.equal(releaseRevision(env, () => JSON.stringify({ revision })), revision);
  assert.equal(releaseRevision(env, () => JSON.stringify({ revision: null })), null);
  assert.equal(releaseRevision(env, () => 'private invalid JSON'), null);
  const missing = () => { throw Object.assign(new Error('private path'), { code: 'ENOENT' }); };
  assert.equal(releaseRevision(env, missing), env.RENDER_GIT_COMMIT);
  assert.equal(releaseRevision({ RENDER_GIT_COMMIT: 'private-invalid' }, missing), null);
});

test('worker heartbeat carries payment runtime identity without adding provider calls or log output', async () => {
  const heartbeats = [], logs = [];
  const noop = { enabled: false, drain: async () => {}, stop: async () => {} };
  const evidence = paymentRuntimeEvidence(config);
  const runtime = createWorkerRuntime({ sequelize: { authenticate: async () => {},
    query: async (_sql, options) => heartbeats.push(JSON.parse(options.replacements.details)) },
    services: { paymentRuntime: evidence, email: noop, notifications: noop, exports: [], payments: { ...noop, enabled: true } },
    pollIntervalMs: 1000, log: { error: value => logs.push(value) } });
  await runtime.start();
  try {
    assert.deepEqual(heartbeats[0].paymentRuntime, evidence);
    assert.equal(heartbeats[0].paymentReconciliationEnabled, true);
    assert.doesNotMatch(JSON.stringify(heartbeats), /private|example|sk_test|whsec|pk_test/);
    assert.equal(logs.length, 0);
  } finally { await runtime.stop(); }
});
