const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupSandboxAttempt } = require('../stripe-tests/payment-cleanup.cjs');

const args = { accountId: 'acct_fixture', orderId: '11111111-1111-4111-8111-111111111111', sessionId: 'cs_test_fixture' };
function fixture(patch = {}) {
  const session = { id: args.sessionId, livemode: false, metadata: { orderId: args.orderId }, currency: 'usd', amount_total: 2240,
    status: 'open', payment_status: 'unpaid', ...patch };
  const calls = [];
  const sdk = { checkout: { sessions: {
    retrieve: async (id, params, options) => { assert.equal(id, args.sessionId); assert.equal(options.stripeAccount, args.accountId); return session; },
    expire: async (...values) => { calls.push(['expire', ...values]); },
  } }, refunds: { create: async (...values) => { calls.push(['refund', ...values]); return { id: 're_fixture', amount: 2240, status: 'succeeded' }; } } };
  return { sdk, calls };
}
const paid = { status: 'complete', payment_status: 'paid', payment_intent: { livemode: false, status: 'succeeded', amount_received: 2240,
  latest_charge: { id: 'ch_fixture', livemode: false, amount: 2240, amount_refunded: 0, refunded: false } } };
test('failed sandbox browser attempts expire the exact unpaid session', async () => {
  const { sdk, calls } = fixture();
  assert.deepEqual(await cleanupSandboxAttempt({ ...args, sdk }), { status: 'expired-unpaid-session' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'expire');
  assert.equal(calls[0][1], args.sessionId);
  assert.equal(calls[0][3].stripeAccount, args.accountId);
});
test('failed paid sandbox attempts refund the full payment and application fee with a stable cleanup key', async () => {
  const { sdk, calls } = fixture(paid);
  assert.deepEqual(await cleanupSandboxAttempt({ ...args, sdk }), { status: 'failure-cleanup-fully-refunded', refundId: 're_fixture' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].refund_application_fee, true);
  assert.equal(calls[0][2].idempotencyKey, `nitewide-sandbox-refund-${args.orderId}`);
});
test('cleanup does not refund an already fully refunded sandbox payment again', async () => {
  const { sdk, calls } = fixture({ ...paid, payment_intent: { ...paid.payment_intent, latest_charge: { ...paid.payment_intent.latest_charge, refunded: true, amount_refunded: 2240 } } });
  assert.deepEqual(await cleanupSandboxAttempt({ ...args, sdk }), { status: 'already-fully-refunded' });
  assert.equal(calls.length, 0);
});
test('cleanup refuses live, mismatched, oversized, partial or unknown payment states before writes', async () => {
  for (const patch of [{ livemode: true }, { metadata: { orderId: 'other' } }, { amount_total: 5001 }, { currency: 'eur' },
    { status: 'complete', payment_status: 'unpaid' }, { ...paid, payment_intent: { ...paid.payment_intent, latest_charge: { ...paid.payment_intent.latest_charge, amount_refunded: 100 } } }]) {
    const { sdk, calls } = fixture(patch);
    await assert.rejects(cleanupSandboxAttempt({ ...args, sdk }));
    assert.equal(calls.length, 0);
  }
});
