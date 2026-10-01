const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeRefundService } = require('../src/services/stripe-refund-service');

test('refund sweep bounds work, isolates failures and never exposes provider errors', async () => {
  let query, calls = 0;
  const rows = ['one', 'two'].map(id => ({ id, orderId: `order-${id}`, status: 'pending', stripeAccountId: 'acct_test', paymentAccountId: 'profile', amountCents: 100, currency: 'USD', approvedByUserId: 'merchant', createdAt: new Date() }));
  const models = {
    Refund: { findAll: async options => { query = options; return rows; }, update: async () => {} },
    Order: { findByPk: async id => ({ id, providerMode: 'test', stripeAccountId: 'acct_test', paymentAccountId: 'profile', totalCents: 100, currency: 'USD', status: 'paid', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test' }) },
  };
  const service = createStripeRefundService({ models, stripe: { enabled: true, mode: 'test', createRefund: async (params, options) => {
    calls++; assert.equal(options.idempotencyKey, `refund/${params.metadata.refundId}`);
    assert.equal(params.amount, 100); assert.equal(params.refund_application_fee, true);
    throw Object.assign(new Error('secret provider details'), { code: 'sk_secret' });
  } } });
  const results = await service.sweepPendingRefunds({ limit: 10000 });
  assert.equal(query.limit, 25); assert.equal(calls, 2);
  assert.deepEqual(results, rows.map(row => ({ refundId: row.id, orderId: row.orderId, status: 'pending', retryable: true })));
  models.Order.findByPk = async () => null;
  const invalid = await service.sweepPendingRefunds({ limit: -1 });
  assert.equal(query.limit, 25); assert.equal(calls, 2);
  assert.equal(invalid[0].code, 'REFUND_STATE_CONFLICT');
  assert.equal(JSON.stringify(invalid).includes('secret'), false);
});

test('aged lost refund creation is held for review without a provider replay', async () => {
  const refund = { id: 'refund', orderId: 'order', status: 'pending', stripeAccountId: 'acct_test', paymentAccountId: 'profile', amountCents: 100, currency: 'USD', approvedByUserId: 'merchant', createdAt: new Date(0) };
  const models = { Order: { findByPk: async () => ({ id: 'order', status: 'paid', providerMode: 'test', stripeAccountId: 'acct_test', paymentAccountId: 'profile', totalCents: 100, currency: 'USD', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test' }) } };
  const service = createStripeRefundService({ models, stripe: { enabled: true, mode: 'test', createRefund: async () => assert.fail('Aged approval must not create money movement') } });
  await assert.rejects(service.reconcile(refund), { code: 'REFUND_STATE_CONFLICT' });
});
