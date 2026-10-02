const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSandboxInvocation, sandboxCredentials, accountParameters, assertOwnedSandboxAccount, verifiedReadiness, safeFailure, createStripeTestIdentity, reusableSandboxAccount } = require('../stripe-tests/sandbox-policy.cjs');
const root = require('../../../package.json');
const { discoverTests } = require('../scripts/run-tests.cjs');
const path = require('node:path');
const { waitFor, command } = require('../stripe-tests/runtime.cjs');

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
  assert.doesNotThrow(() => assertSandboxInvocation(['--run'], credentials));
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--resume', 'api-onboarding-20261001-012345abcdef'], credentials));
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--resume', 'payment-regression-20261001-012345abcdef'], credentials));
  assert.doesNotThrow(() => assertSandboxInvocation(['--run', '--account', 'acct_fixture'], credentials));
  for (const args of [[], ['--run', '--other'], ['--other'], ['--run', '--resume', '../account'], ['--run', '--resume', 'acct_someoneElse'], ['--run', '--account', '../account'], ['--run', '--account', 'acct_fixture', '--resume', 'other']]) assert.throws(() => assertSandboxInvocation(args, credentials));
  for (const overrides of [{ CI: 'true' }, { CI: '1' }, { NODE_ENV: 'production' }, { HOSTED_DEMO: 'true' }, { STRIPE_MODE: 'disabled' }, { STRIPE_SECRET_KEY: 'sk_live_notallowed' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_notallowed' }]) assert.throws(() => assertSandboxInvocation(['--run'], { ...credentials, ...overrides }));
  assert.equal(root.scripts['test:stripe:sandbox'], 'node apps/api/stripe-tests/run.cjs --run');
  for (const [name, script] of Object.entries(root.scripts)) if (name !== 'test:stripe:sandbox') assert.equal(script.includes('stripe-tests/run.cjs'), false, name);
  assert.equal(discoverTests(path.resolve(__dirname, '../stripe-tests')).length, 0);
});
test('sandbox credentials expose no Resend key or deployed signing secret', () => {
  const a = sandboxCredentials({ ...credentials, RESEND_API_KEY: 'never', STRIPE_WEBHOOK_SECRET: 'whsec_deployed' });
  assert.equal(Object.hasOwn(a, 'RESEND_API_KEY'), false);
  assert.notEqual(a.STRIPE_WEBHOOK_SECRET, 'whsec_deployed');
  assert.notEqual(a.STRIPE_WEBHOOK_SECRET, sandboxCredentials(credentials).STRIPE_WEBHOOK_SECRET);
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
test('interrupted sandbox work refuses new subprocesses and provider polls', async () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('Synthetic interrupt'), { code: 'SANDBOX_INTERRUPTED' }));
  let called = false;
  await assert.rejects(waitFor(async () => { called = true; }, () => true, 'Synthetic abort', 100, { signal: controller.signal }), { code: 'SANDBOX_INTERRUPTED' });
  await assert.rejects(command(['-e', 'process.exit(1)'], {}, { signal: controller.signal }), { code: 'SANDBOX_INTERRUPTED' });
  assert.equal(called, false);
});
