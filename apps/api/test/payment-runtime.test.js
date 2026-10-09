const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseRevision, paymentRuntimeEvidence } = require('../src/diagnostics/payment-runtime');
const { createWorkerRuntime } = require('../src/background/runtime');

const revision = 'a'.repeat(40);
const config = { NODE_ENV: 'production', hostedDemo: true, RELEASE_REVISION: revision,
  AUTH_TOKEN_SECRET: 'private-auth-'.repeat(4), STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_private',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_private', STRIPE_WEBHOOK_SECRET: 'whsec_privatepayment',
  STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_privateaccount', STRIPE_CONNECT_CLIENT_ID: 'ca_private',
  CUSTOMER_APP_URL: 'https://example.com', businessAppUrl: 'https://example.com/business',
  corsOrigins: ['https://example.com', 'https://business.example.com'] };

test('payment runtime evidence detects configuration drift without returning settings or secrets', () => {
  const evidence = paymentRuntimeEvidence(config);
  assert.equal(evidence.revision, revision);
  assert.match(evidence.configurationFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(paymentRuntimeEvidence({ ...config, corsOrigins: [...config.corsOrigins].reverse() }), evidence);
  for (const key of ['AUTH_TOKEN_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
    'STRIPE_ACCOUNT_WEBHOOK_SECRET', 'STRIPE_CONNECT_CLIENT_ID', 'CUSTOMER_APP_URL', 'businessAppUrl', 'APP_ROUTING_MODE', 'ADMIN_APP_URL', 'TRUST_PROXY_MODE', 'TRUST_PROXY_HOPS', 'STRIPE_MODE', 'NODE_ENV', 'APP_ENVIRONMENT',
    'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'EMAIL_ENCRYPTION_KEY', 'RESEND_WEBHOOK_SECRET',
    'MEDIA_STORAGE_DRIVER', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT']) {
    assert.notEqual(paymentRuntimeEvidence({ ...config, [key]: 'different' }).configurationFingerprint, evidence.configurationFingerprint, key);
  }
  assert.notEqual(paymentRuntimeEvidence({ ...config, EMAIL_DELIVERY_POLICY: 'essential' }).configurationFingerprint, evidence.configurationFingerprint);
  assert.notEqual(paymentRuntimeEvidence({ ...config, resendTestMode: true }).configurationFingerprint, evidence.configurationFingerprint);
  assert.notEqual(paymentRuntimeEvidence({ ...config, STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_private' }).configurationFingerprint, evidence.configurationFingerprint);
  const media = { ...config, MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'nitewide-staging-media',
    R2_ACCESS_KEY_ID: 'private-access-key', R2_SECRET_ACCESS_KEY: 'private-storage-secret' };
  assert.deepEqual(paymentRuntimeEvidence({ ...media, R2_ENDPOINT: `https://${media.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` }), paymentRuntimeEvidence(media));
  assert.doesNotMatch(JSON.stringify(paymentRuntimeEvidence(media)), /private|nitewide-staging-media/);
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
