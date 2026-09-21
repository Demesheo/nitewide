const test = require("node:test");
const assert = require("node:assert/strict");
const { calculatePricing, PLAN_POLICIES } = require("../src/domain/pricing");
test("Free pricing is 7.5% plus $0.79 paid by buyer; organizer pays Stripe separately", () => {
  assert.deepEqual(
    calculatePricing({
      subtotalCents: 10_000,
      planTier: "free",
      commissionBps: 800,
    }),
    {
      platformFeeCents: 829,
      totalCents: 10_829,
      affiliateCommissionCents: 800,
      pricingPlanSnapshot: { tier: "free", ...PLAN_POLICIES.free },
    },
  );
  assert.equal(PLAN_POLICIES.free.processingPaidBy, "organizer");
});
test("Premium has $249 monthly pricing without a transaction-fee discount", () => {
  const result = calculatePricing({
    subtotalCents: 10_000,
    planTier: "premium",
  });
  assert.equal(PLAN_POLICIES.premium.monthlyFeeCents, 24_900);
  assert.equal(result.platformFeeCents, 829);
  assert.equal(result.totalCents, 10_829);
  assert.equal(result.pricingPlanSnapshot.processingPaidBy, "organizer");
});
test("free orders do not receive per-order platform fees", () => {
  assert.equal(
    calculatePricing({ subtotalCents: 0, planTier: "free" }).platformFeeCents,
    0,
  );
});
test("rounding never defeats the 10% buyer-fee saving against the published single-ticket Posh benchmark", () => {
  for (let subtotalCents = 1; subtotalCents <= 100000; subtotalCents++) {
    const fee = calculatePricing({ subtotalCents }).platformFeeCents;
    const posh = Math.round(subtotalCents * 0.1) + 99;
    assert.ok(fee * 10 <= posh * 9);
  }
});
test("invalid currency amounts cannot produce invalid fees", () => {
  for (const subtotalCents of [-1, 1.5, NaN, Infinity])
    assert.throws(() => calculatePricing({ subtotalCents }), RangeError);
});
