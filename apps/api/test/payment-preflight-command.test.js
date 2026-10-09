const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parseOptions } = require('../../../deploy/payment-preflight.cjs');

const revision = 'a'.repeat(40);
const report = (changes = {}) => ({ scope: 'payment-preflight', mode: 'sandbox-ready', checkedAt: '2026-10-04T12:00:00.000Z', checks: [],
  schema: { status: 'ready', missingTableCount: 0, missingColumnCount: 0, missingMigrationCount: 0 },
  routing: { status: 'ready', activePaidEventCount: 1, readyEventCount: 1, blockedEventCount: 0,
    eventSpecificCount: 0, organizationDefaultCount: 1, sharedSandboxCount: 0 },
  workers: { status: 'ready', healthyWorkerCount: 1, matchingWorkerCount: 1, mismatchedWorkerCount: 0 },
  runtime: { revision }, evidence: { keyPairIdentity: 'not-verified', webhookDelivery: 'not-verified', providerReadiness: 'stored-snapshot-only' }, ...changes });

test('payment command help and invalid targets never access secrets, a database or the network', async () => {
  const output = [];
  assert.equal(await run(['--help'], { environment: {}, log: value => output.push(value),
    fetchImpl: () => assert.fail('network'), loadConfig: () => assert.fail('configuration') }), 0);
  assert.match(output[0], /read-only/);
  for (const args of [['--unknown'], ['--expect-revision', 'short'], ['--url', 'https://user:private@example.com'],
    ['--url', 'https://example.com?token=private'], ['--url', 'https://example.com/path'], ['--url', 'https://127.0.0.1'],
    ['--url', 'http://example.com'], ['--url', 'https://192.168.1.2'], ['--url', 'https://server.internal']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.equal(parseOptions(['--url', 'http://127.0.0.1:4000']).url, 'http://127.0.0.1:4000');
});

test('deployed payment command uses private authorization, exact release expectations and no redirects', async () => {
  for (const mode of ['sandbox-ready', 'live-ready']) {
  const output = [];
  const code = await run(['--url', 'https://example.com', '--require-paid', '--expect-revision', revision], {
    environment: { PAYMENT_PREFLIGHT_ADMIN_TOKEN: 'private-session' }, log: value => output.push(value),
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://example.com');
      assert.equal(url.pathname, '/api/admin/diagnostics/payments');
      assert.equal(url.searchParams.get('requirePaid'), 'true');
      assert.equal(url.searchParams.get('expectRevision'), revision);
      assert.equal(options.headers.Authorization, 'Bearer private-session');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ data: report({ mode }) }) };
    }, loadConfig: () => assert.fail('must inspect deployed configuration, not local settings'),
  });
  assert.equal(code, 0);
  assert.doesNotMatch(output.join('\n'), /private-session|Bearer|example\.com/);
  }
});

test('paid release gate rejects disabled, incomplete, older and secret-bearing remote reports', async () => {
  for (const value of [report({ mode: 'disabled' }), report({ mode: 'configuration-blocked' }),
    report({ runtime: { revision: 'b'.repeat(40) } }), report({ workers: { status: 'blocked', healthyWorkerCount: 0, matchingWorkerCount: 0, mismatchedWorkerCount: 0 } }),
    report({ schema: { status: 'blocked', missingTableCount: 1, missingColumnCount: 0, missingMigrationCount: 0 } }),
    report({ routing: { status: 'ready', activePaidEventCount: 0, readyEventCount: 0, blockedEventCount: 0, eventSpecificCount: 0, organizationDefaultCount: 0, sharedSandboxCount: 0 } }),
    report({ checks: [{ code: 'PAYMENT_SCHEMA_MISSING', status: 'fail', message: require('../src/diagnostics/payment-preflight').CHECK_MESSAGES.PAYMENT_SCHEMA_MISSING }] }),
    report({ privateExtra: 'sk_test_private' }), report({ checks: [{ code: 'PAYMENTS_DISABLED', status: 'fail', message: 'private SQL token' }] })]) {
    const output = [];
    assert.equal(await run(['--url', 'https://example.com', '--require-paid', '--expect-revision', revision], {
      environment: { PAYMENT_PREFLIGHT_ADMIN_TOKEN: 'private-session' }, log: value => output.push(value),
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: value }) }),
    }), 1);
    assert.doesNotMatch(output.join('\n'), /privateExtra|sk_test_private|private SQL token|private-session/);
  }
  for (const failure of [async () => { throw new Error('https://private?token=secret'); }, async () => ({ ok: false, status: 403 })]) {
    const output = [];
    assert.equal(await run(['--url', 'https://example.com'], { environment: { PAYMENT_PREFLIGHT_ADMIN_TOKEN: 'private-session' },
      log: value => output.push(value), fetchImpl: failure }), 1);
    assert.doesNotMatch(output.join('\n'), /https:|token=|secret|private-session/);
  }
});

test('local preflight uses the effective runtime and model schema, closes its pool and permits intentionally disabled payments', async () => {
  const config = { private: 'secret' }, models = {}, output = []; let closed = 0;
  const database = { close: async () => { closed++; } };
  const dependencies = { environment: {}, log: value => output.push(value), loadConfig: () => config,
    createDatabase: value => { assert.equal(value, config); return database; },
    createModels: value => { assert.equal(value, database); return models; },
    createPreflight: input => {
      assert.equal(input.config, config); assert.equal(input.sequelize, database); assert.equal(input.models, models);
      return { inspect: async () => report({ mode: 'disabled' }) };
    }, fetchImpl: () => assert.fail('no provider or network') };
  assert.equal(await run([], dependencies), 0); assert.equal(closed, 1);
  assert.equal(await run(['--require-paid'], dependencies), 1); assert.equal(closed, 2);
  assert.equal(await run([], { ...dependencies, createPreflight: () => ({ inspect: async () => { throw new Error('password=secret'); } }) }), 1);
  assert.equal(closed, 3);
  assert.doesNotMatch(output.join('\n'), /private|password=|secret/);
});
