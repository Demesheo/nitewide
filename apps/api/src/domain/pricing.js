const PLAN_POLICIES = Object.freeze({
  free: Object.freeze({
    monthlyFeeCents: 0,
    percentageBps: 750,
    perPaidOrderCents: 79,
    processingPaidBy: "organizer",
    version: "2026-09-21-organizer-processing",
  }),
  premium: Object.freeze({
    monthlyFeeCents: 24_900,
    percentageBps: 750,
    perPaidOrderCents: 79,
    processingPaidBy: "organizer",
    version: "2026-09-21-organizer-processing",
  }),
});

function roundBasisPoints(cents, bps) {
  return Math.round((cents * bps) / 10_000);
}
function calculatePricing({
  subtotalCents,
  planTier = "free",
  commissionBps = 0,
}) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0)
    throw new RangeError("Subtotal must be non-negative integer cents");
  const policy = PLAN_POLICIES[planTier] || PLAN_POLICIES.free;
  // Buyer service fee only. Stripe is an organizer expense, not another buyer fee.
  // Actual processor costs/settlement must come from verified provider records.
  const platformFeeCents =
    subtotalCents > 0
      ? roundBasisPoints(subtotalCents, policy.percentageBps) +
        policy.perPaidOrderCents
      : 0;
  return {
    platformFeeCents,
    totalCents: subtotalCents + platformFeeCents,
    affiliateCommissionCents: roundBasisPoints(subtotalCents, commissionBps),
    pricingPlanSnapshot: { tier: planTier, ...policy },
  };
}
module.exports = { PLAN_POLICIES, roundBasisPoints, calculatePricing };
