const { POLICY, quoteOrder, bps: roundBasisPoints } = require('@nitewide/pricing');
const { DomainError } = require('./errors');
const PLAN_POLICIES = Object.freeze({
  free: Object.freeze({ monthlyFeeCents: 0, ...POLICY }),
  premium: Object.freeze({ monthlyFeeCents: 24900, ...POLICY }),
});
function calculatePricing({ subtotalCents, planTier = 'free', commissionBps = 0,
  items = [{ unitPriceCents: subtotalCents, quantity: 1 }], currency = 'USD', costs, now, benchmark }) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new RangeError('Invalid subtotal');
  if (!Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 4000) throw new RangeError('Invalid commission');
  const quote = quoteOrder({ items, currency, costs, now, benchmark });
  if (quote.subtotalCents !== subtotalCents) throw new RangeError('Item subtotal mismatch');
  if (!quote.eligible) throw new DomainError('This combination is not available at our current pricing. Try another offering or quantity.',
    { code: 'PRICING_UNAVAILABLE', status: 422 });
  return { platformFeeCents: quote.feeCents, totalCents: quote.totalCents,
    affiliateCommissionCents: roundBasisPoints(subtotalCents, commissionBps),
    pricingPlanSnapshot: { tier: planTier, ...(PLAN_POLICIES[planTier] || PLAN_POLICIES.free),
      pricingDecision: quote } };
}
module.exports = { PLAN_POLICIES, roundBasisPoints, calculatePricing };
