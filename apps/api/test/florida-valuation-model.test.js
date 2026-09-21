const test = require('node:test');
const assert = require('node:assert/strict');
const { assumptions, calculate } = require('../../../scripts/florida-valuation-model');

test('Florida model takes 10% of venue-funded promoter kickbacks without changing attribution share', () => {
  const result = calculate();
  assert.equal(assumptions.promoterAttributedTransactionShare, 0.25);
  assert.equal(assumptions.nitewideKickbackFeeRate, 0.10);
  assert.equal(Math.round(result.grossPromoterKickbacks), 2_623_111);
  assert.equal(Math.round(result.promoterServiceFeeRevenue), 262_311);
  assert.equal(Math.round(result.promoterNetRewards), 2_360_800);
});

test('Florida model charges Stripe percentage on face value plus buyer fees', () => {
  const result = calculate();
  const expected = result.customerCheckoutVolume * assumptions.stripeRate + result.transactions * assumptions.stripeFixedFee;
  assert.equal(result.stripeCosts, expected);
  assert.ok(result.customerCheckoutVolume > result.faceValueGmv);
});
