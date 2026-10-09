const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSandboxInvocation, sandboxCredentials, accountParameters, assertOwnedSandboxAccount, verifiedReadiness, safeFailure, createStripeTestIdentity, reusableSandboxAccount } = require('../stripe-tests/sandbox-policy.cjs');
const root = require('../../../package.json');
const { discoverTests } = require('../scripts/run-tests.cjs');
const path = require('node:path');
const { waitFor, command } = require('../stripe-tests/runtime.cjs');
const { installBrowserVerificationGate } = require('../stripe-tests/browser-verification.cjs');

const credentials = { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic' };
test('explicit sandbox command reuses the shared merchant by default without changing a resumed attempt',()=>{
  const environment={...credentials,STRIPE_SANDBOX_SHARED_ACCOUNT_ID:'acct_shared'};
  assert.equal(reusableSandboxAccount(['--run'],environment),'acct_shared');
  assert.equal(reusableSandboxAccount(['--run','--account','acct_explicit'],environment),'acct_explicit');
  assert.equal(reusableSandboxAccount(['--run','--resume','payment-regression-20261001-012345abcdef'],environment),null);
  assert.equal(reusableSandboxAccount(['--run'],credentials),null);
  assert.throws(()=>reusableSandboxAccount(['--run'],{...environment,STRIPE_SECRET_KEY:'sk_live_wrong'}));
});
test('real Stripe tests require a unique explicit local command and reject CI/live targets', () => {
  for (const prefix of ['sk', 'rk']) {
    const environment = { ...credentials, STRIPE_SECRET_KEY: `${prefix}_test_synthetic` };
    assert.doesNotThrow(() => assertSandboxInvocation(['--run'], environment));
    assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--account', 'acct_fixture'], environment));
    assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--resume', 'payment-regression-20261001-012345abcdef'], environment));
  }
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--resume', 'api-onboarding-20261001-012345abcdef'], credentials));
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--resume', 'payment-regression-20261001-012345abcdef'], credentials));
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--account', 'acct_fixture'], credentials));
  for (const args of [[], ['--run', '--other'], ['--other'], ['--run', '--resume', '../account'], ['--run', '--resume', 'acct_someoneElse'], ['--run', '--account', '../account'], ['--run', '--account', 'acct_fixture', '--resume', 'other']]) assert.throws(() => assertSandboxInvocation(args, credentials));
  for (const prefix of ['sk', 'rk']) {
    const environment = { ...credentials, STRIPE_SECRET_KEY: `${prefix}_test_synthetic` };
    for (const overrides of [{ CI: 'true' }, { CI: '1' }, { NODE_ENV: 'production' }, { APP_ENVIRONMENT: 'production' },
      { HOSTED_DEMO: 'true' }, { hostedDemo: true }, { STRIPE_MODE: 'disabled' }, { STRIPE_MODE: 'live' },
      { STRIPE_SECRET_KEY: 'sk_live_notallowed' }, { STRIPE_SECRET_KEY: 'rk_live_notallowed' },
      { STRIPE_SECRET_KEY: 'rk_test_' }, { STRIPE_SECRET_KEY: 'rk_test_synthetic\n' }, { STRIPE_SECRET_KEY: 'pk_test_notaserverkey' },
      { STRIPE_PUBLISHABLE_KEY: 'pk_live_notallowed' }, { STRIPE_PUBLISHABLE_KEY: 'rk_test_notpublishable' }]) {
      assert.throws(() => assertSandboxInvocation(['--run'], { ...environment, ...overrides }));
      assert.throws(() => sandboxCredentials({ ...environment, ...overrides }), 'credential extraction cannot bypass the local sandbox guard');
    }
  }
  assert.equal(root.scripts['test:stripe:sandbox'], 'node apps/api/stripe-tests/run.cjs --run');
  for (const [name, script] of Object.entries(root.scripts)) if (name !== 'test:stripe:sandbox') assert.equal(script.includes('stripe-tests/run.cjs'), false, name);
  assert.equal(discoverTests(path.resolve(__dirname, '../stripe-tests')).length, 0);
});
test('sandbox credentials expose no Resend key or deployed signing secret', () => {
  for (const prefix of ['sk', 'rk']) {
    const environment = { ...credentials, STRIPE_SECRET_KEY: `${prefix}_test_synthetic`, RESEND_API_KEY: 'never',
      STRIPE_WEBHOOK_SECRET: 'whsec_deployed', STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_deployedaccount' };
    const a = sandboxCredentials(environment);
    assert.equal(a.STRIPE_MODE, 'test');
    assert.equal(a.STRIPE_SECRET_KEY, environment.STRIPE_SECRET_KEY);
    assert.equal(a.STRIPE_PUBLISHABLE_KEY, credentials.STRIPE_PUBLISHABLE_KEY);
    assert.equal(Object.hasOwn(a, 'RESEND_API_KEY'), false);
    assert.notEqual(a.STRIPE_WEBHOOK_SECRET, 'whsec_deployed');
    assert.notEqual(a.STRIPE_ACCOUNT_WEBHOOK_SECRET, 'whsec_deployedaccount');
    assert.notEqual(a.STRIPE_WEBHOOK_SECRET, a.STRIPE_ACCOUNT_WEBHOOK_SECRET);
    assert.notEqual(a.STRIPE_WEBHOOK_SECRET, sandboxCredentials(environment).STRIPE_WEBHOOK_SECRET);
  }
});
test('test API fixture preserves production responsibilities and generated email convention', () => {
  const identity = createStripeTestIdentity('api-onboarding');
  const params = accountParameters(identity);
  assert.equal(params.contact_email, identity.email);
  assert.equal(params.dashboard, 'full');
  assert.deepEqual(params.defaults.responsibilities, { fees_collector: 'stripe', losses_collector: 'stripe' });
  assert.equal(params.identity.individual.id_numbers[0].value, '0000');
  assert.equal(params.identity.individual.date_of_birth.year, 1902);
  assert.equal(params.metadata.nitewide_test_identifier, identity.testIdentifier);
  assert.equal(params.identity.attestations, undefined, 'Stripe collects full-Dashboard merchant agreement acceptance; the platform must not attest on their behalf.');
  assert.throws(() => accountParameters({ email: 'real@example.com' }));
});
test('only Stripe-verified active tagged full-Dashboard accounts can proceed to payment', () => {
  const identity = createStripeTestIdentity('test');
  const account = { id: 'acct_fixture', object: 'v2.core.account', livemode: false, dashboard: 'full', metadata: accountParameters(identity).metadata,
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
    applied_configurations: ['merchant'], configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' } } } }, requirements: { entries: [] } };
  assertOwnedSandboxAccount(account, identity);
  assert.equal(verifiedReadiness(account), true);
  for (const patch of [{ livemode: true }, { dashboard: 'none' }, { metadata: {} }]) assert.throws(() => assertOwnedSandboxAccount({ ...account, ...patch }, identity));
  account.configuration.merchant.capabilities.card_payments.status = 'restricted';
  assert.equal(verifiedReadiness(account), false);
});
test('sandbox failures redact messages, credentials, request bodies and provider URLs', () => {
  assert.deepEqual(safeFailure({ type: 'StripeInvalidRequestError', code: 'parameter_invalid', statusCode: 400, message: 'sk_test_secret cs_secret https://secret', raw: { password: 'secret' } }), { type: 'StripeInvalidRequestError', code: 'parameter_invalid', httpStatus: 400 });
  assert.deepEqual(safeFailure({ type: 'StripePermissionError', code: 'permission_missing', statusCode: 403,
    message: 'rk_test_secret rk_live_secret https://secret', raw: { key: 'rk_test_secret', permissions: 'private' } }),
  { type: 'StripePermissionError', code: 'permission_missing', httpStatus: 403 });
  assert.deepEqual(safeFailure({ type: 'unsafe https://private', code: 'unsafe secret' }), { type: 'Error', code: 'SANDBOX_TEST_FAILED' });
});
test('explicit merchant reuse requires a Nitewide profile, the exact test account and unchanged fee responsibilities', () => {
  const identity = { ...createStripeTestIdentity('payment-regression'), accountSource: 'existing-business', expectedStripeAccountId: 'acct_fixture',
    sourcePaymentProfileId: '11111111-1111-4111-8111-111111111111' };
  const account = { id: 'acct_fixture', object: 'v2.core.account', livemode: false, dashboard: 'full',
    metadata: { nitewide_payment_account_id: identity.sourcePaymentProfileId },
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } } };
  assert.equal(assertOwnedSandboxAccount(account, identity), account);
  for (const patch of [{id:'acct_other'}, {livemode:true}, {closed:true}, {dashboard:'express'}, {metadata:{}},
    {metadata:{nitewide_payment_account_id:'22222222-2222-4222-8222-222222222222'}}]) assert.throws(()=>assertOwnedSandboxAccount({...account,...patch},identity));
  assert.throws(()=>assertOwnedSandboxAccount(account,{...identity,sourcePaymentProfileId:'not-a-profile'}));
});
test('sandbox polling awaits asynchronous verification and times out without inventing success', async () => {
  let count = 0;
  const value = await waitFor(async () => ++count, async value => value === 3, 'Synthetic poll', 1000, { intervalMs: 1 });
  assert.equal(value, 3);
  assert.equal(count, 3);
  await assert.rejects(waitFor(async () => false, async value => value, 'Synthetic timeout', 10, { intervalMs: 1 }), { code: 'SANDBOX_TIMEOUT' });
});
async function verificationFixture({ status = 200, data, fetch, invalidJson = false } = {}) {
  const base = 'http://127.0.0.1:12345', orderId = 'offline-order';
  let registration, removed;
  const page = { route: async (url, handler) => { registration = { url, handler }; },
    unroute: async (url, handler) => { removed = { url, handler }; } };
  const response = { status: () => status, json: async () => {
    if (invalidJson) throw new Error('Synthetic unparseable response');
    return { data: data ?? { orderId, status: 'pending', verificationStatus: 'pending' }, client_secret: 'cs_test_neverlog' };
  } };
  const gate = await installBrowserVerificationGate(page, { base, orderId });
  function request({ url = registration.url, method = 'POST' } = {}) {
    const calls = { fetch: 0, fulfill: [], abort: [], continue: 0 };
    const route = { request: () => ({ url: () => url, method: () => method }),
      fetch: async options => { calls.fetch++; assert.deepEqual(options, { maxRedirects: 0, timeout: 15000 }); return fetch ? fetch(response) : response; },
      fulfill: async options => { calls.fulfill.push(options); }, abort: async reason => { calls.abort.push(reason); },
      continue: async () => { calls.continue++; } };
    return { calls, run: () => registration.handler(route) };
  }
  return { gate, request, response, registration, removed: () => removed };
}
test('sandbox browser gate preserves the genuine exact-order precheck and blocks concurrent/later reconciliation until webhook release', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await verificationFixture({ fetch: async response => { await pending; return response; } });
  assert.equal(fixture.registration.url, 'http://127.0.0.1:12345/api/customer/payment-checkouts/offline-order/verify');
  assert.equal(fixture.gate.ready(), false);
  for (const options of [{ method: 'GET' }, { url: fixture.registration.url.replace('offline-order', 'other-order') }]) {
    const ignored = fixture.request(options); await ignored.run();
    assert.deepEqual(ignored.calls, { fetch: 0, fulfill: [], abort: [], continue: 1 });
  }
  const first = fixture.request(), firstRun = first.run();
  assert.equal(first.calls.fetch, 1, 'the first app precheck must reach the real API, not receive a synthetic 503');
  assert.deepEqual(first.calls.fulfill, []);
  assert.equal(fixture.gate.ready(), false);
  const concurrent = fixture.request(); await concurrent.run();
  assert.equal(concurrent.calls.fetch, 0, 'claim the single precheck before awaiting its response');
  assert.equal(concurrent.calls.fulfill[0].status, 503);
  release(); await firstRun;
  assert.deepEqual(first.calls.fulfill, [{ response: fixture.response }], 'forward the original response without inventing pending/payment success');
  assert.equal(fixture.gate.ready(), true);
  const later = fixture.request(); await later.run();
  assert.equal(later.calls.fetch, 0); assert.equal(later.calls.fulfill[0].status, 503);
  assert.deepEqual(fixture.gate.snapshot(), { precheck: 'passed', reason: null, httpStatus: 200, requests: 3, blockedRequests: 2 });
  assert.doesNotMatch(JSON.stringify(fixture.gate.snapshot()), /offline-order|127\.0\.0\.1|cs_test_neverlog/);
  await fixture.gate.release();
  assert.deepEqual(fixture.removed(), fixture.registration, 'release only this order handler after webhook assertions');
});
test('sandbox precheck rejects uncertain, mismatched and unsuccessful API evidence without synthesizing a usable response', async () => {
  for (const [options, reason] of [
    [{ status: 503 }, 'http-status'], [{ invalidJson: true }, 'invalid-response'],
    [{ data: { orderId: 'another-order', status: 'pending' } }, 'order-mismatch'],
    [{ data: { orderId: 'offline-order', status: 'paid' } }, 'not-pending'],
    [{ data: { orderId: 'offline-order', status: 'pending', verificationStatus: 'review' } }, 'review'],
    [{ data: { orderId: 'offline-order', status: 'pending', retryable: true } }, 'retryable'],
  ]) {
    const fixture = await verificationFixture(options), first = fixture.request(); await first.run();
    assert.throws(() => fixture.gate.ready(), { code: 'SANDBOX_PRECHECK_FAILED' });
    assert.equal(fixture.gate.snapshot().reason, reason); assert.equal(fixture.gate.snapshot().precheck, 'rejected');
    assert.deepEqual(first.calls.fulfill, [], 'uncertain pending evidence must not reach provider confirmation');
    assert.deepEqual(first.calls.abort, ['failed']);
    const retry = fixture.request(); await retry.run(); assert.equal(retry.calls.fetch, 0); assert.equal(retry.calls.fulfill[0].status, 503);
  }
  const failed = await verificationFixture({ fetch: async () => { throw new Error('private response details cs_test_neverlog'); } });
  const request = failed.request(); await request.run();
  assert.deepEqual(request.calls.abort, ['failed']); assert.deepEqual(request.calls.fulfill, []);
  assert.throws(() => failed.gate.ready(), { code: 'SANDBOX_PRECHECK_FAILED' });
  assert.deepEqual(failed.gate.snapshot(), { precheck: 'failed', reason: 'request-failed', httpStatus: null, requests: 1, blockedRequests: 0 });
});
test('interrupted sandbox work refuses new subprocesses and provider polls', async () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('Synthetic interrupt'), { code: 'SANDBOX_INTERRUPTED' }));
  let called = false;
  await assert.rejects(waitFor(async () => { called = true; }, () => true, 'Synthetic abort', 100, { signal: controller.signal }), { code: 'SANDBOX_INTERRUPTED' });
  await assert.rejects(command(['-e', 'process.exit(1)'], {}, { signal: controller.signal }), { code: 'SANDBOX_INTERRUPTED' });
  assert.equal(called, false);
});
