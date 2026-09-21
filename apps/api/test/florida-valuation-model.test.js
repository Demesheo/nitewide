const test = require('node:test');
const assert = require('node:assert/strict');
const { assumptions, calculate, customerAdSlotsPerPage } = require('../../../scripts/florida-valuation-model');
test('current policy assigns 7.5% + $0.79 to buyers and processing to organizers', () => {
  const r = calculate();
  assert.equal(assumptions.buyerFeeRate, .075);
  assert.equal(assumptions.buyerFixedFee, .79);
  assert.equal(assumptions.stripePaidBy, 'organizer');
  assert.equal(r.buyerFees, r.faceValueGmv * .075 + r.transactions * .79);
  assert.equal(r.organizerStripeCosts, r.stripeCosts);
  assert.equal(r.platformStripeCosts, 0);
  assert.equal(r.processorAdjustedContribution, r.grossPlatformRevenue);
});

test('Florida model takes 10% of venue-funded promoter kickbacks without changing attribution share', () => {
  const result = calculate();
  assert.equal(assumptions.averageVipTransaction, 400);
  assert.equal(assumptions.promoterAttributedTransactionShare, 0.50);
  assert.equal(assumptions.nitewideKickbackFeeRate, 0.10);
  assert.equal(Math.round(result.grossPromoterKickbacks), 2_773_333);
  assert.equal(Math.round(result.promoterServiceFeeRevenue), 277_333);
  assert.equal(Math.round(result.promoterNetRewards), 2_496_000);
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
  assert.equal(Math.round(result.grossPromoterKickbacks), 2_773_333);
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
