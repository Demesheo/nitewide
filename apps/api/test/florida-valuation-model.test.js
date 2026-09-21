const test = require('node:test');
const assert = require('node:assert/strict');
const { assumptions, calculate } = require('../../../scripts/florida-valuation-model');

test('Florida model takes 10% of venue-funded promoter kickbacks without changing attribution share', () => {
  const result = calculate();
  assert.equal(assumptions.promoterAttributedTransactionShare, 0.25);
  assert.equal(assumptions.nitewideKickbackFeeRate, 0.10);
  assert.equal(Math.round(result.grossPromoterKickbacks), 2_831_111);
  assert.equal(Math.round(result.promoterServiceFeeRevenue), 283_111);
  assert.equal(Math.round(result.promoterNetRewards), 2_548_000);
});

test('Florida model charges Stripe percentage on face value plus buyer fees', () => {
  const result = calculate();
  const expected = result.customerCheckoutVolume * assumptions.stripeRate + result.transactions * assumptions.stripeFixedFee;
  assert.equal(result.stripeCosts, expected);
  assert.ok(result.customerCheckoutVolume > result.faceValueGmv);
});

test('Florida model adds one ticket-only non-nightclub event per ten nightclub events', () => {
  const result = calculate();
  assert.equal(Math.round(result.nonNightclubEvents), 1_664);
  assert.equal(Math.round(result.nonNightclubGmv), 8_320_000);
  assert.equal(Math.round(result.nonNightclubTransactions), 208_000);
  assert.equal(Math.round(result.grossPromoterKickbacks), 2_831_111);
});
