const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Stripe = require('stripe');
const { createApp } = require('../src/app');
const { createStripeClient } = require('../src/payments/stripe-client');
const schemas = require('../src/http/payment-schemas');
const { DomainError } = require('../src/domain/errors');

const buyerId = '10000000-0000-4000-8000-000000000001';
const orderId = '10000000-0000-4000-8000-000000000002';
const config = { NODE_ENV: 'test', corsOrigins: [], AUTH_TOKEN_SECRET: 'development-test-secret-32-characters',
  STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
  STRIPE_WEBHOOK_SECRET: 'whsec_paymentmock', STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_accountmock' };
function fixture(changes = {}) {
  const calls = [], modelCalls = [], event = { id: 'evt_accountmock', object: 'v2.core.event', type: 'v2.core.account.updated', livemode: false,
    related_object: { id: 'acct_unknown', type: 'v2.core.account' } };
  // Only local SDK signature functions are real. Every provider retrieval and
  // domain mutation is stubbed; no ambient environment/key or network is used.
  const stripe = { ...createStripeClient(config) };
  for (const [name, value] of Object.entries(stripe)) {
    if (typeof value === 'function' && !['constructWebhookEvent', 'constructAccountNotification'].includes(name)) {
      stripe[name] = async () => { calls.push(['unexpected-provider-call', name]); assert.fail(`Provider method ${name} must be explicitly stubbed in this HTTP fixture`); };
    }
  }
  stripe.retrieveAccountNotification = async id => { calls.push(['retrieve-event', id]); return event; };
  const result = { orderId, status: 'pending', verificationStatus: 'pending' };
  const app = createApp({ sequelize: {}, models: { PaymentAccount: { findOne: async options => { modelCalls.push(['payment-account', options]); return null; } } }, config: { ...config, ...changes }, healthCheck: async () => {},
    services: { stripe, email: { enabled: false }, permissions: { assertInternal: async () => {}, assertBusinessAccess: async () => {} },
      auth: { authenticate: async token => { if (token !== 'local-mock-session') throw new DomainError('Sign in required', { code: 'UNAUTHENTICATED', status: 401 }); return { id: buyerId }; } },
      abuse: { before: async () => {}, authenticated: async () => {} },
      paymentCheckouts: {
        prepare: async input => { calls.push(['prepare', input]); return { ...result, clientSecret: 'cs_mock_secret_private', stripeAccountId: 'acct_mock', expiresAt: '2026-10-01T12:00:00.000Z' }; },
        resume: async (...input) => { calls.push(['resume', ...input]); return { ...result, clientSecret: 'cs_mock_secret_private', stripeAccountId: 'acct_mock', booking: {
          idempotencyKey: 'stable-checkout-key', event: { id: orderId, title: 'Original booking', startsAt: '2026-10-01T20:00:00.000Z', endsAt: '2026-10-02T02:00:00.000Z' },
          currency: 'USD', subtotalCents: 1000, totalCents: 1164, items: [{ offeringId: orderId, name: 'Ticket', kind: 'ticket', quantity: 1, unitPriceCents: 1000 }],
        } }; },
        verify: async (...input) => { calls.push(['verify', ...input]); return result; },
        cancel: async (...input) => { calls.push(['cancel', ...input]); return result; },
        lookup: async (...input) => { calls.push(['lookup', ...input]); return result; },
      },
    } });
  return { app, calls, modelCalls, event, stripe };
}
const signed = (payload, secret) => Stripe.webhooks.generateTestHeaderString({ payload, secret });
const authorized = pending => pending.set('Authorization', 'Bearer local-mock-session');

test('publishable configuration is public, no-store and contains no private credentials', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/customer/payment-config').expect(200).expect('Cache-Control', 'no-store');
  schemas.paymentConfiguration.parse(response.body.data);
  assert.deepEqual(response.body.data, { configured: true, enabled: true, mode: 'test', publishableKey: 'pk_test_mock', demoEnabled: false });
  assert.doesNotMatch(JSON.stringify(response.body), /sk_test_|whsec_|AUTH_TOKEN_SECRET/);
  assert.equal((await request(fixture({ STRIPE_ACCOUNT_WEBHOOK_SECRET: undefined }).app).get('/api/customer/payment-config')).body.data.enabled, false);
});
test('resume payment is private, validates the order ID and uses only the signed-in buyer identity', async () => {
  const { app, calls } = fixture();
  await request(app).post(`/api/customer/payment-checkouts/${orderId}/resume`).expect(401);
  await authorized(request(app).post('/api/customer/payment-checkouts/not-a-uuid/resume')).expect(422);
  assert.equal(calls.length, 0);
  const response = await authorized(request(app).post(`/api/customer/payment-checkouts/${orderId}/resume`)).send({ buyerUserId: 'forged', items: [], stripeAccountId: 'acct_forged' }).expect(200).expect('Cache-Control', 'no-store');
  schemas.checkoutResumption.parse(response.body.data);
  assert.deepEqual(calls, [['resume', buyerId, orderId]]);
});
test('buyer payment operations require a session and reject caller-supplied payment success', async () => {
  const { app, calls } = fixture();
  const input = { eventId: orderId, idempotencyKey: 'stable-checkout-key', items: [{ offeringId: orderId, quantity: 1 }] };
  await request(app).post('/api/customer/payment-checkouts').send(input).expect(401);
  await authorized(request(app).post('/api/customer/payment-checkouts')).send({ ...input, payment: { status: 'succeeded' } }).expect(422);
  assert.equal(calls.length, 0);
  const response = await authorized(request(app).post('/api/customer/payment-checkouts')).send(input).expect(200).expect('Cache-Control', 'no-store');
  schemas.checkoutPreparation.parse(response.body.data);
  assert.equal(calls[0][1].buyerUserId, buyerId);
  for (const action of ['verify', 'cancel']) {
    await request(app).post(`/api/customer/payment-checkouts/${orderId}/${action}`).expect(401);
    schemas.checkoutSummary.parse((await authorized(request(app).post(`/api/customer/payment-checkouts/${orderId}/${action}`)).expect(200)).body.data);
  }
  await request(app).get('/api/customer/checkout-attempts/stable-checkout-key').expect(401);
  schemas.checkoutSummary.parse((await authorized(request(app).get('/api/customer/checkout-attempts/stable-checkout-key')).expect(200)).body.data);
});
test('snapshot webhook verifies the original bytes before acknowledging an unknown sandbox account', async () => {
  const { app, calls, modelCalls } = fixture();
  const payload = '{ "id": "evt_paymentmock", "livemode": false, "account": "acct_unknown", "type": "checkout.session.completed" }';
  const signature = signed(payload, config.STRIPE_WEBHOOK_SECRET);
  const response = await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload).expect(200);
  assert.deepEqual(response.body, { received: true, ignored: true }); schemas.webhookAcknowledgment.parse(response.body);
  assert.equal(modelCalls.length, 1); modelCalls.length = 0;
  await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(`${payload} `).expect(400);
  await request(app).post('/api/webhooks/stripe').send({ id: 'forged', livemode: false }).expect(400);
  for (const value of [{ id: 'evt_unscoped', livemode: false }, ...[undefined, null, 'false', 0].map(livemode => ({ id: 'evt_malformed', account: 'acct_unknown', type: 'account.updated', livemode }))]) {
    const raw = JSON.stringify(value);
    await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw, config.STRIPE_WEBHOOK_SECRET)).send(raw).expect(400);
  }
  assert.deepEqual(calls, []); assert.deepEqual(modelCalls, []);
});
test('validly signed opposite-mode snapshots acknowledge ignored before any model or provider calls', async () => {
  for (const [configuredMode, livemode] of [['test', true], ['live', false]]) {
    const { app, calls, modelCalls, stripe } = fixture();
    // The route uses the shared injected adapter; signature verification is
    // still the SDK's real local verifier for both adapter-mode cases.
    stripe.mode = configuredMode;
    const raw = JSON.stringify({ id: 'evt_opposite_mode', account: 'acct_unknown', type: 'checkout.session.completed', livemode, data: { object: { id: 'cs_opposite_mode' } } });
    await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw, 'whsec_wrong')).send(raw).expect(400);
    const response = await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw, config.STRIPE_WEBHOOK_SECRET)).send(raw).expect(200);
    assert.deepEqual(response.body, { received: true, ignored: true });
    schemas.webhookAcknowledgment.parse(response.body);
    assert.deepEqual(calls, []); assert.deepEqual(modelCalls, []);
  }
});
test('thin account webhook requires its own signing secret and retrieves the event independently', async () => {
  const { app, calls } = fixture();
  const raw = JSON.stringify({ id: 'evt_accountmock', type: 'v2.core.account.updated', related_object: { id: 'acct_unknown', type: 'v2.core.account', url: '/v2/core/accounts/acct_unknown' } });
  await request(app).post('/api/webhooks/stripe/accounts').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw, config.STRIPE_WEBHOOK_SECRET)).send(raw).expect(400);
  assert.equal(calls.length, 0);
  const response = await request(app).post('/api/webhooks/stripe/accounts').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw, config.STRIPE_ACCOUNT_WEBHOOK_SECRET)).send(raw).expect(200);
  assert.deepEqual(response.body, { received: true, ignored: true });
  assert.deepEqual(calls, [['retrieve-event', 'evt_accountmock']]);
});
test('webhook bodies are bounded, content-typed and unsupported methods have a clear response', async () => {
  const { app, calls } = fixture();
  for (const path of ['/api/webhooks/stripe', '/api/webhooks/stripe/accounts']) {
    await request(app).get(path).expect(405).expect('Allow', /POST/);
    await request(app).post(path).set('Content-Type', 'text/plain').send('{}').expect(400);
    await request(app).post(path).set('Content-Type', 'application/json').send('x'.repeat(256 * 1024 + 1)).expect(413);
  }
  assert.equal(calls.length, 0);
});
test('hosted document security policy narrowly allows city lookup and required Stripe origins without broadening script execution', async () => {
  const { app } = fixture();
  const response = await request(app).get('/health/live').expect(200);
  const csp = response.headers['content-security-policy'];
  assert.match(csp, /script-src[^;]*https:\/\/js\.stripe\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/hooks\.stripe\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.stripe\.com/);
  assert.ok(csp.match(/connect-src[^;]*/)[0].split(' ').includes('https://api.bigdatacloud.net/data/reverse-geocode-client'));
  assert.doesNotMatch(csp, /https:\/\/\*\.bigdatacloud|https:\/\/api\.bigdatacloud\.net(?:\s|;)/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval|\shttps:\s|\s\*\s/);
  const withoutStripe = await request(fixture({ STRIPE_SECRET_KEY: undefined, STRIPE_PUBLISHABLE_KEY: undefined }).app).get('/health/live').expect(200);
  assert.equal(withoutStripe.headers['content-security-policy'].match(/connect-src[^;]*/)[0], "connect-src 'self' https://api.bigdatacloud.net/data/reverse-geocode-client");
});
