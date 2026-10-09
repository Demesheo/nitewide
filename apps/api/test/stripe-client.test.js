const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeClient, stripeConfiguration, STRIPE_API_VERSION } = require('../src/payments/stripe-client');
const { getConfig } = require('../src/config');
const { offlineEnvironment } = require('../scripts/test-database.cjs');
const { stripeApplicationFee } = require('../src/domain/stripe-pricing');
const { calculatePricing } = require('../src/domain/pricing');
const { isStripeMode, stripeLivemode, matchesStripeLivemode } = require('../src/payments/stripe-mode');

const config = { NODE_ENV: 'development', STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_mock',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_mock', STRIPE_WEBHOOK_SECRET: 'whsec_mock', STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_accountmock', hostedDemo: false };
test('Stripe configuration rejects live credentials outside production and does not expose secret credentials', () => {
  for (const changes of [{ STRIPE_SECRET_KEY: 'sk_live_mock' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_mock' }, { STRIPE_MODE: 'live' }]) {
    assert.throws(() => getConfig({ ...config, ...changes, DATABASE_URL: 'postgres://test:test@localhost:5433/db' }));
  }
  assert.deepEqual(stripeConfiguration(config), { configured: true, enabled: true, mode: 'test', publishableKey: 'pk_test_mock', demoEnabled: false });
  assert.equal(STRIPE_API_VERSION, '2026-08-26.dahlia');
  assert.equal(createStripeClient({ STRIPE_MODE: 'disabled' }), null);
  assert.throws(() => createStripeClient({ ...config, STRIPE_SECRET_KEY: 'sk_live_mock' }), { code: 'PAYMENTS_NOT_ENABLED' });
});
test('onboarding is available before webhook setup, but paid operations fail closed', () => {
  let creates = 0;
  const client = createStripeClient({ ...config, STRIPE_WEBHOOK_SECRET: '' }, { sdk: { v2: { core: { accounts: { create: () => ++creates } } } } });
  assert.equal(client.createAccount({}), 1);
  assert.equal(client.enabled, false);
  assert.throws(() => client.createCheckoutSession({}, { stripeAccount: 'acct_mock' }), { code: 'PAYMENTS_NOT_ENABLED' });
  assert.throws(() => client.constructWebhookEvent(Buffer.from('{}'), 'signature'), { code: 'PAYMENTS_NOT_ENABLED' });
  assert.equal(creates, 1);
  for (const name of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY']) {
    assert.equal(stripeConfiguration({ ...config, [name]: '' }).enabled, false);
  }
});
test('explicit sandbox configuration works on the hosted demo without falling back to fake payment success', () => {
  assert.deepEqual(stripeConfiguration({ ...config, hostedDemo: true, NODE_ENV: 'production',
    CUSTOMER_APP_URL: 'https://demo.example.test', BUSINESS_APP_URL: 'https://demo.example.test/app' }), {
    configured: true, enabled: true, mode: 'test', publishableKey: 'pk_test_mock', demoEnabled: false,
  });
  assert.equal(stripeConfiguration({ STRIPE_MODE: 'disabled', hostedDemo: true, NODE_ENV: 'production' }).demoEnabled, true);
});
test('live clients require explicit production, complete matching credentials and public callbacks before any SDK operation', () => {
  const live = { ...config, NODE_ENV: 'production', APP_ENVIRONMENT: 'production', HOSTED_DEMO: 'false',
    STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_mock', STRIPE_PUBLISHABLE_KEY: 'pk_live_mock',
    CUSTOMER_APP_URL: 'https://production.example.test', BUSINESS_APP_URL: 'https://production.example.test/app' };
  let calls = 0;
  const sdk = { checkout: { sessions: { create: () => ++calls } } };
  assert.deepEqual(stripeConfiguration(live), { configured: true, enabled: true, mode: 'live', publishableKey: 'pk_live_mock', demoEnabled: false });
  const client = createStripeClient(live, { sdk });
  assert.equal(client.mode, 'live');
  assert.equal(client.createCheckoutSession({}, { stripeAccount: 'acct_live' }), 1);
  assert.equal(createStripeClient({ ...live, STRIPE_MODE: 'disabled' }, { sdk }), null);
  assert.deepEqual(stripeConfiguration({ ...live, STRIPE_MODE: 'disabled' }), {
    configured: false, enabled: false, mode: 'disabled', publishableKey: null, demoEnabled: false,
  });
  for (const changes of [
    { NODE_ENV: 'development' }, { APP_ENVIRONMENT: 'staging' }, { APP_ENVIRONMENT: undefined },
    { HOSTED_DEMO: undefined }, { HOSTED_DEMO: 'true' }, { hostedDemo: true },
    { STRIPE_SECRET_KEY: 'sk_test_mock' }, { STRIPE_PUBLISHABLE_KEY: 'pk_test_mock' },
    { STRIPE_WEBHOOK_SECRET: '' }, { STRIPE_ACCOUNT_WEBHOOK_SECRET: '' }, { STRIPE_PUBLISHABLE_KEY: '' },
    { STRIPE_ACCOUNT_WEBHOOK_SECRET: live.STRIPE_WEBHOOK_SECRET },
    { CUSTOMER_APP_URL: undefined }, { BUSINESS_APP_URL: 'http://localhost:5174/app' },
    { STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_shared' }, { STRIPE_MODE: '[' },
  ]) {
    assert.throws(() => createStripeClient({ ...live, ...changes }, { sdk }));
    assert.equal(stripeConfiguration({ ...live, ...changes }).enabled, false);
    assert.equal(stripeConfiguration({ ...live, ...changes }).demoEnabled, false);
  }
  assert.equal(calls, 1, 'invalid or disabled settings never reach the supplied SDK');
});
test('provider mode checks accept only exact booleans in known modes', () => {
  for (const [mode, expected] of [['test', false], ['live', true]]) {
    assert.equal(isStripeMode(mode), true); assert.equal(stripeLivemode(mode), expected);
    assert.equal(matchesStripeLivemode({ livemode: expected }, mode), true);
    for (const value of [undefined, null, !expected, String(expected), Number(expected)]) {
      assert.equal(matchesStripeLivemode({ livemode: value }, mode), false);
    }
  }
  for (const mode of ['disabled', undefined, null, 'LIVE', true]) {
    assert.equal(isStripeMode(mode), false); assert.equal(stripeLivemode(mode), null);
    assert.equal(matchesStripeLivemode({ livemode: true }, mode), false);
    assert.equal(matchesStripeLivemode({ livemode: false }, mode), false);
  }
  assert.equal(matchesStripeLivemode(null, 'live'), false);
});
test('Dahlia account operations use v2 includes, hosted onboarding links and a separate thin signing secret', () => {
  const calls = [], raw = Buffer.from('{"id":"evt_mock"}');
  const sdk = { v2: { core: {
    accounts: { create: (...args) => calls.push(['create', ...args]), retrieve: (...args) => calls.push(['account', ...args]) },
    accountLinks: { create: (...args) => calls.push(['link', ...args]) }, events: { retrieve: (...args) => calls.push(['event', ...args]) },
  } }, parseEventNotification: (...args) => calls.push(['thin', ...args]) };
  const client = createStripeClient(config, { sdk });
  const params = { dashboard: 'full' }, options = { idempotencyKey: 'original' }, link = { account: 'acct_mock', use_case: { type: 'account_onboarding' } };
  client.createAccount(params, options); client.retrieveAccount('acct_mock'); client.createAccountLink(link);
  client.constructAccountNotification(raw, 'signed'); client.retrieveAccountNotification('evt_mock');
  assert.deepEqual(calls, [
    ['create', params, options], ['account', 'acct_mock', { include: ['configuration.merchant', 'defaults', 'requirements'] }],
    ['link', link], ['thin', raw, 'signed', 'whsec_accountmock'], ['event', 'evt_mock'],
  ]);
  assert.deepEqual(client.checkoutPaymentMethodOptions, { payment_method_types: ['card', 'link'], wallet_options: { link: { display: 'auto' } } });
});
test('direct charges retain account scope while application fees use platform scope', () => {
  const calls = [];
  const sdk = { checkout: { sessions: { retrieve: (...args) => calls.push(['session', ...args]) } },
    refunds: { create: (...args) => calls.push(['refund', ...args]) }, applicationFees: { retrieve: (...args) => calls.push(['fee', ...args]) },
    webhooks: { constructEvent: (...args) => calls.push(['webhook', ...args]) } };
  const client = createStripeClient(config, { sdk });
  client.retrieveCheckoutSession('cs_mock', { stripeAccount: 'acct_mock', expand: ['payment_intent.latest_charge'] });
  client.createRefund({ refund_application_fee: true }, { stripeAccount: 'acct_mock', idempotencyKey: 'stable' });
  client.retrieveApplicationFee('fee_mock');
  client.constructWebhookEvent(Buffer.from('{}'), 'signed');
  assert.deepEqual(calls[0], ['session', 'cs_mock', { expand: ['payment_intent.latest_charge'] }, { stripeAccount: 'acct_mock' }]);
  assert.deepEqual(calls[1], ['refund', { refund_application_fee: true }, { stripeAccount: 'acct_mock', idempotencyKey: 'stable' }]);
  assert.deepEqual(calls[2], ['fee', 'fee_mock', {}]);
  assert.equal(calls[3][3], 'whsec_mock');
  assert.throws(() => client.retrieveCheckoutSession('cs_mock', {}), { code: 'PAYMENTS_NOT_READY' });
});
test('normal API/database and browser test environments disable all ambient Stripe credentials', () => {
  const environment = offlineEnvironment({ ...config, STRIPE_API_KEY: 'sk_test_another', RESEND_API_KEY: 'secret' });
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET', 'STRIPE_API_KEY']) assert.equal(environment[key], '');
  assert.equal(environment.STRIPE_MODE, 'disabled');
  assert.equal(stripeConfiguration(environment).configured, false);
});
test('direct-charge fees exclude modeled Stripe processing and retain commission as an unpaid merchant obligation', () => {
  for (const feeMode of ['buyer', 'absorbed']) {
    const pricing = calculatePricing({ subtotalCents: 10000, feeMode, commissionBps: 1000 });
    const result = stripeApplicationFee(pricing);
    const quote = pricing.pricingPlanSnapshot.pricingDecision;
    assert.equal(result.applicationFeeCents + result.modeledProcessorFeeCents, quote.feeCents);
    assert.equal(result.nitewideFeeCents, quote.contributionCents);
    assert.equal(result.commissionCents, 1000);
    assert.equal(result.commissionSettlement, 'merchant_obligation');
    assert.equal(result.economicsBasis, 'modeled_sandbox_costs');
    assert.deepEqual(stripeApplicationFee(pricing, 'live'), { ...result, economicsBasis: 'modeled_provider_costs' }, 'live mode preserves customer prices and application fees');
    assert.throws(() => stripeApplicationFee(pricing, 'unknown'), { code: 'PRICING_UNAVAILABLE' });
  }
  assert.equal(stripeApplicationFee(calculatePricing({ subtotalCents: 0 })).applicationFeeCents, 0);
  assert.throws(() => stripeApplicationFee({ totalCents: 1000 }), { code: 'PRICING_UNAVAILABLE' });
});
