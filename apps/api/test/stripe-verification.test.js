const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySession } = require('../src/services/stripe-checkout-service');
const { verifyRefund } = require('../src/services/stripe-refund-service');
const { customerOrder } = require('../src/controllers/commerce-controller');
function fixture() {
  const order = { id: 'order', checkoutSessionId: 'cs_test', totalCents: 2320, currency: 'USD', applicationFeeCents: 150, stripeAccountId: 'acct_test', stripePaymentIntentId: 'pi_test', stripeChargeId: 'ch_test' };
  const charge = { id: 'ch_test', payment_intent: 'pi_test', livemode: false, paid: true, captured: true, amount: 2320, currency: 'usd', application_fee_amount: 150, amount_refunded: 0, refunded: false };
  const session = { id: 'cs_test', mode: 'payment', livemode: false, metadata: { orderId: 'order' }, client_reference_id: 'order', amount_total: 2320, currency: 'usd', status: 'complete', payment_status: 'paid',
    payment_intent: { id: 'pi_test', livemode: false, status: 'succeeded', metadata: { orderId: 'order' }, amount: 2320, amount_received: 2320, currency: 'usd', application_fee_amount: 150, latest_charge: charge } };
  return { order, session, charge };
}
test('verified session requires immutable order, amount, currency, mode, intent, charge and direct fee bindings', () => {
  const f = fixture();
  assert.equal(verifySession(f.order, f.session).paid, true);
  const changes = [s => { s.livemode = true; }, s => { s.metadata.orderId = 'other'; }, s => { s.client_reference_id = 'other'; },
    s => { s.amount_total += 1; }, s => { s.currency = 'eur'; }, s => { s.payment_intent.status = 'processing'; },
    s => { s.payment_intent.amount_received -= 1; }, s => { s.payment_intent.application_fee_amount += 1; },
    s => { s.payment_intent.transfer_data = { destination: 'acct_other' }; }, s => { s.payment_intent.latest_charge.paid = false; },
    s => { s.payment_intent.latest_charge.payment_intent = 'pi_other'; }, s => { s.payment_intent.latest_charge.application_fee_amount += 1; },
    s => { s.payment_intent.latest_charge.amount_refunded = 100; }];
  for (const change of changes) { const session = structuredClone(f.session); change(session); assert.throws(() => verifySession(f.order, session), { code: 'PAYMENT_VERIFICATION_FAILED' }); }
});
test('open/processing remains pending and only provider-confirmed expired unpaid can release reservations', () => {
  const f = fixture();
  assert.deepEqual(verifySession(f.order, { ...f.session, payment_status: 'unpaid', status: 'open' }), { paid: false, expired: false });
  assert.deepEqual(verifySession(f.order, { ...f.session, payment_status: 'unpaid', status: 'expired' }), { paid: false, expired: true });
});
test('refund verification includes full customer amount, direct-account charge and application fee refund', () => {
  const f = fixture(), refund = { id: 'local-refund', providerReference: 're_test' };
  const evidence = { id: 're_test', livemode: false, status: 'succeeded', amount: 2320, currency: 'usd', payment_intent: 'pi_test', charge: 'ch_test', metadata: { refundId: refund.id, orderId: f.order.id } };
  const charge = { ...f.charge, refunded: true, amount_refunded: 2320, application_fee: 'fee_test' };
  const fee = { id: 'fee_test', amount: 150, livemode: false, currency: 'usd', refunded: true, amount_refunded: 150, account: 'acct_test', charge: 'ch_test' };
  assert.equal(verifyRefund(f.order, refund, evidence, charge, fee), true);
  const withoutLivemode = { ...evidence }; delete withoutLivemode.livemode;
  assert.equal(verifyRefund(f.order, refund, withoutLivemode, charge, fee), true, 'Stripe Refund objects infer mode from verified Charge');
  assert.equal(verifyRefund(f.order, refund, { ...evidence, amount: 2000 }, charge, fee), false);
  assert.equal(verifyRefund(f.order, refund, evidence, charge, { ...fee, refunded: false }), false);
  assert.equal(verifyRefund(f.order, refund, evidence, charge, { ...fee, account: 'acct_other' }), false);
});
test('customer orders exclude merchant/provider/reservation internals and fee decisions', () => {
  const f = fixture();
  const data = customerOrder({ ...f.order, paymentAccountId: 'private', providerVerificationStatus: 'pending', providerMode: 'test', reservationExpiresAt: new Date(), pricingPlanSnapshot: { demo: false, merchant: { private: true }, stripeFeeDecision: { private: true }, providerCustomerEmail: 'private@offline.test', providerSessionPreparedAt: 'private', providerSessionParams: { return_url: 'private', customer_email: 'private@offline.test' } } });
  for (const key of ['paymentAccountId', 'stripeAccountId', 'checkoutSessionId', 'applicationFeeCents', 'stripePaymentIntentId', 'stripeChargeId', 'reservationExpiresAt', 'providerMode', 'providerVerificationStatus']) assert.equal(key in data, false, key);
  for (const key of ['merchant', 'stripeFeeDecision', 'providerCustomerEmail', 'providerSessionPreparedAt', 'providerSessionParams']) assert.equal(key in data.pricingPlanSnapshot, false, key);
});
