const assert = require('node:assert/strict');

// A failed browser run must not leave an open checkout or an unrefunded test
// payment. Scope every operation to the exact generated order on its merchant.
async function cleanupSandboxAttempt({ sdk, accountId, orderId, sessionId }) {
  assert.match(accountId, /^acct_[A-Za-z0-9]+$/);
  assert.match(orderId, /^[a-f0-9-]{36}$/i);
  assert.match(sessionId, /^cs_test_[A-Za-z0-9]+$/);
  const options = { stripeAccount: accountId };
  const session = await sdk.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] }, options);
  assert.equal(session.id, sessionId);
  assert.equal(session.livemode, false);
  assert.equal(session.metadata?.orderId, orderId);
  assert.equal(session.currency, 'usd');
  assert.ok(Number.isInteger(session.amount_total) && session.amount_total > 0 && session.amount_total <= 5000);
  if (session.status === 'open') {
    await sdk.checkout.sessions.expire(sessionId, {}, { ...options, idempotencyKey: `nitewide-sandbox-expire-${orderId}` });
    return { status: 'expired-unpaid-session' };
  }
  if (session.payment_status !== 'paid') {
    assert.equal(session.status, 'expired', 'Unexpected payment state requires manual inspection.');
    return { status: 'already-expired-unpaid-session' };
  }
  const intent = session.payment_intent;
  const charge = intent?.latest_charge;
  assert.equal(intent?.livemode, false);
  assert.equal(intent.status, 'succeeded');
  assert.equal(intent.amount_received, session.amount_total);
  assert.equal(charge?.livemode, false);
  assert.equal(charge.amount, session.amount_total);
  if (charge.refunded === true && charge.amount_refunded === charge.amount) return { status: 'already-fully-refunded' };
  assert.equal(charge.amount_refunded, 0, 'Partial refunds require manual inspection.');
  const refund = await sdk.refunds.create({ charge: charge.id, refund_application_fee: true,
    metadata: { nitewide_test_cleanup: orderId } }, { ...options, idempotencyKey: `nitewide-sandbox-refund-${orderId}` });
  assert.equal(refund.amount, session.amount_total);
  assert.equal(refund.status, 'succeeded');
  return { status: 'failure-cleanup-fully-refunded', refundId: refund.id };
}

module.exports = { cleanupSandboxAttempt };
