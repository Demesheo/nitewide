const test = require('node:test'); const assert = require('node:assert/strict');
const { calculatePricing, PLAN_POLICIES } = require('../src/domain/pricing');
test('Free pricing is 8% plus $0.89 for a paid order', () => { assert.deepEqual(calculatePricing({ subtotalCents: 10_000, planTier: 'free', commissionBps: 800 }), { platformFeeCents: 889, totalCents: 10_889, affiliateCommissionCents: 800, pricingPlanSnapshot: { tier: 'free', ...PLAN_POLICIES.free } }); });
test('Premium has $249 monthly pricing without a transaction-fee discount', () => { const result = calculatePricing({ subtotalCents: 10_000, planTier: 'premium' }); assert.equal(PLAN_POLICIES.premium.monthlyFeeCents, 24_900); assert.equal(result.platformFeeCents, 889); assert.equal(result.totalCents, 10_889); });
test('free orders do not receive per-order platform fees', () => { assert.equal(calculatePricing({ subtotalCents: 0, planTier: 'free' }).platformFeeCents, 0); });
