const assert = require('node:assert/strict');
const id = value => typeof value === 'string' ? value : value?.id;

// Evidence is retrieved with the sandbox SDK: the charge transaction is scoped
// to the merchant, while the application fee transaction belongs to Nitewide.
function verifyApplicationFeeEvidence(order, accountId, charge, fee, platformTransaction) {
  const merchantTransaction = charge.balance_transaction;
  assert.equal(charge.livemode, false, 'charge must be a sandbox payment');
  assert.equal(charge.id, order.stripeChargeId, 'charge must belong to this order');
  assert.equal(id(charge.payment_intent), order.stripePaymentIntentId, 'intent must belong to this order');
  assert.equal(id(charge.application_fee), fee.id, 'charge must reference this fee');
  assert.equal(fee.livemode, false, 'fee must be a sandbox application fee');
  assert.equal(id(fee.account), accountId, 'fee must belong to this merchant');
  assert.equal(id(fee.charge), charge.id, 'fee must belong to this charge');
  assert.equal(fee.amount, order.applicationFeeCents, 'provider application fee must match the server quote');
  assert.equal(fee.amount_refunded, 0, 'fee must not already be refunded');
  assert.equal(fee.currency.toUpperCase(), order.currency.toUpperCase(), 'application fee currency');
  assert.equal(id(fee.balance_transaction), platformTransaction.id, 'platform transaction must belong to this fee');
  assert.equal(id(platformTransaction.source), fee.id, 'platform transaction source');
  assert.equal(platformTransaction.type, 'application_fee', 'platform transaction type');
  assert.equal(platformTransaction.currency.toUpperCase(), order.currency.toUpperCase(), 'platform transaction currency');
  assert.equal(platformTransaction.amount, fee.amount, 'Nitewide balance must receive the application fee');
  assert.equal(platformTransaction.fee, 0, 'Stripe-owned processing must not be charged to Nitewide again');
  assert.equal(platformTransaction.net, fee.amount, 'Nitewide application fee net');
  assert.ok(merchantTransaction && typeof merchantTransaction === 'object', 'merchant balance evidence must be expanded');
  assert.equal(id(merchantTransaction.source), charge.id, 'merchant balance transaction source');
  assert.equal(merchantTransaction.currency.toUpperCase(), order.currency.toUpperCase(), 'merchant transaction currency');
  assert.equal(merchantTransaction.amount, order.totalCents, 'merchant gross amount');
  assert.ok(Number.isSafeInteger(merchantTransaction.fee) && merchantTransaction.fee >= fee.amount, 'merchant deductions include the application fee');
  assert.equal(merchantTransaction.net, merchantTransaction.amount - merchantTransaction.fee, 'merchant net balance');
  return { applicationFeeCents: fee.amount, nitewideNetCents: platformTransaction.net,
    merchantGrossCents: merchantTransaction.amount, merchantNetCents: merchantTransaction.net,
    merchantOtherFeesCents: merchantTransaction.fee - fee.amount,
    currency: order.currency.toUpperCase() };
}

module.exports = { verifyApplicationFeeEvidence };
