const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeCheckoutService } = require('../src/services/stripe-checkout-service');

function fixture(elapsedMs = 0, persistedParams = true) {
  const prepared = new Date('2026-10-01T12:00:00Z');
  const params = { ui_mode: 'elements', mode: 'payment', payment_method_types: ['card'],
    return_url: 'https://original.example/?session_id={CHECKOUT_SESSION_ID}', expires_at: prepared.getTime() / 1000 + 35 * 60,
    customer_email: 'buyer@offline.test', line_items: [{ quantity: 1, price_data: { unit_amount: 2000, currency: 'usd', product_data: { name: 'Original ticket' } } }] };
  const order = { id: 'order', eventId: 'event', stripeAccountId: 'acct_original', status: 'pending', providerMode: 'test', providerVerificationStatus: 'pending',
    pricingPlanSnapshot: { providerSessionPreparedAt: prepared.toISOString(), ...(persistedParams ? { providerSessionParams: params } : {}) },
    update: async function(values) { Object.assign(this, values); }, reload: async function() { return this; } };
  let locked = false, calls = 0; const audits = [];
  const models = { Order: { findByPk: async () => order }, Event: { findByPk: async () => ({ id: 'event' }) }, AuditLog: { create: async value => audits.push(value) } };
  const sequelize = { transaction: async (_options, work) => { locked = true; try { return await work({ LOCK: { UPDATE: 'UPDATE' } }); } finally { locked = false; } } };
  const stripe = { enabled: true, mode: 'test', checkoutPaymentMethodOptions: { payment_method_types: ['different_runtime_method'] },
    createCheckoutSession: async (received, options) => {
      assert.equal(locked, false); calls++; assert.deepEqual(received, params);
      assert.deepEqual(options, { stripeAccount: 'acct_original', idempotencyKey: 'checkout/order' });
      received.return_url = 'provider adapter mutation must not alter stored approval';
      throw new Error('Unknown provider outcome');
    } };
  const service = createStripeCheckoutService({ sequelize, models, stripe, notificationJobs: {},
    customerAppUrl: 'https://changed.example/', now: () => new Date(prepared.getTime() + elapsedMs) });
  return { service, order, audits, stripe, calls: () => calls };
}
test('lost checkout creation replays immutable original URL, email, methods, prices and expiry outside locks', async () => {
  const f = fixture(60 * 1000);
  assert.equal((await f.service.reconcileOrder(f.order)).retryable, true);
  assert.equal((await f.service.reconcileOrder(f.order)).retryable, true);
  assert.equal(f.calls(), 2); assert.equal(f.order.providerVerificationStatus, 'pending');
});
test('unknown creation beyond original Stripe expiry minimum or idempotency window retains stock for audited review', async () => {
  for (const elapsed of [5 * 60 * 1000, 36 * 60 * 1000, 24 * 60 * 60 * 1000]) {
    const f = fixture(elapsed);
    assert.equal((await f.service.reconcileOrder(f.order)).verificationStatus, 'review');
    assert.equal(f.calls(), 0); assert.equal(f.order.status, 'pending'); assert.equal(f.order.checkoutSessionId, undefined);
    assert.equal(f.audits.length, 1); assert.equal(f.audits[0].after.reservationRetained, true);
    await f.service.reconcileOrder(f.order); assert.equal(f.audits.length, 1);
  }
});
test('legacy unknown checkout with no original provider parameter snapshot fails closed', async () => {
  const f = fixture(0, false);
  assert.equal((await f.service.reconcileOrder(f.order)).verificationStatus, 'review');
  assert.equal(f.calls(), 0);
});

test('known sessions remain independently retrievable after creation replay window', async () => {
  const f = fixture(25 * 60 * 60 * 1000); f.order.checkoutSessionId = 'cs_known';
  let retrieved = 0;
  f.stripe.retrieveCheckoutSession = async (id, options) => {
    retrieved++; assert.equal(id, 'cs_known'); assert.equal(options.stripeAccount, 'acct_original');
    throw new Error('Provider unavailable');
  };
  assert.equal((await f.service.reconcileOrder(f.order)).retryable, true);
  assert.equal(retrieved, 1); assert.equal(f.calls(), 0); assert.equal(f.order.providerVerificationStatus, 'pending');
});
test('checkout retries never send a stored order to a different Stripe environment', async () => {
  for (const [orderMode, clientMode] of [['test', 'live'], ['live', 'test']]) {
    const f = fixture(); f.order.providerMode = orderMode; f.stripe.mode = clientMode;
    f.stripe.retrieveCheckoutSession = async () => assert.fail('Cross-mode provider retrieval');
    await assert.rejects(f.service.reconcileOrder(f.order), { code: 'PAYMENT_VERIFICATION_FAILED' });
    f.order.checkoutSessionId = 'cs_existing';
    await assert.rejects(f.service.reconcileOrder(f.order), { code: 'PAYMENT_VERIFICATION_FAILED' });
    assert.equal(f.calls(), 0); assert.equal(f.audits.length, 0);
  }
});
