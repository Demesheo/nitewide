const PLAN_POLICIES = Object.freeze({
  free: Object.freeze({ monthlyFeeCents: 0, percentageBps: 700, perPaidOrderCents: 65 }),
  gold: Object.freeze({ monthlyFeeCents: 19_900, percentageBps: 500, perPaidOrderCents: 50 }),
});

function roundBasisPoints(cents, bps) { return Math.round((cents * bps) / 10_000); }
function calculatePricing({ subtotalCents, planTier = 'free', commissionBps = 0 }) {
  const policy = PLAN_POLICIES[planTier] || PLAN_POLICIES.free;
  const platformFeeCents = subtotalCents > 0 ? roundBasisPoints(subtotalCents, policy.percentageBps) + policy.perPaidOrderCents : 0;
  return {
    platformFeeCents, totalCents: subtotalCents + platformFeeCents,
    affiliateCommissionCents: roundBasisPoints(subtotalCents, commissionBps),
    pricingPlanSnapshot: { tier: planTier, ...policy },
  };
}
module.exports = { PLAN_POLICIES, roundBasisPoints, calculatePricing };

