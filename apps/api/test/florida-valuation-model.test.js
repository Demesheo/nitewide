const test = require('node:test');
const assert = require('node:assert/strict');
const { assumptions, calculate, customerAdSlotsPerPage } = require('../../../scripts/florida-valuation-model');

test('Florida model takes 10% of venue-funded promoter kickbacks without changing attribution share', () => {
  const result = calculate();
  assert.equal(assumptions.promoterAttributedTransactionShare, 0.50);
  assert.equal(assumptions.nitewideKickbackFeeRate, 0.10);
  assert.equal(Math.round(result.grossPromoterKickbacks), 5_662_222);
  assert.equal(Math.round(result.promoterServiceFeeRevenue), 566_222);
  assert.equal(Math.round(result.promoterNetRewards), 5_096_000);
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
  assert.equal(Math.round(result.grossPromoterKickbacks), 5_662_222);
});

test('advertising model uses two Google AdSense slots without exceeding organic content', () => {
  const result = calculate();
  assert.equal(result.adNetwork, 'Google AdSense');
  assert.equal(customerAdSlotsPerPage(assumptions), 2);
  assert.equal(result.personalDataSaleRevenue, 0);
  assert.ok(result.adsenseRevenue > 0);
  assert.equal(result.aggregatedInsightsRevenue, 48_000);
});

test('ad density safety overrides the two-card floor on sparse pages', () => {
  assert.equal(customerAdSlotsPerPage({ ...assumptions, averageEventCardsPerDiscoveryPage: 1 }), 0);
  assert.equal(customerAdSlotsPerPage({ ...assumptions, averageEventCardsPerDiscoveryPage: 2 }), 1);
});
