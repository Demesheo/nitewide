const test = require('node:test'); const assert = require('node:assert/strict');
const { calculatePricing, PLAN_POLICIES } = require('../src/domain/pricing');
test('Free pricing is 7% plus $0.65 for a paid order', () => { assert.deepEqual(calculatePricing({ subtotalCents: 10_000, planTier: 'free', commissionBps: 800 }), { platformFeeCents: 765, totalCents: 10_765, affiliateCommissionCents: 800, pricingPlanSnapshot: { tier: 'free', ...PLAN_POLICIES.free } }); });
test('Gold pricing is 5% plus $0.50 for a paid order', () => { const result = calculatePricing({ subtotalCents: 10_000, planTier: 'gold' }); assert.equal(result.platformFeeCents, 550); assert.equal(result.totalCents, 10_550); });
test('free orders do not receive per-order platform fees', () => { assert.equal(calculatePricing({ subtotalCents: 0, planTier: 'free' }).platformFeeCents, 0); });

