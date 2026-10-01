const { POLICY, quoteOrder, bps: roundBasisPoints } = require('@nitewide/pricing');
const { DomainError } = require('./errors');
const PLAN_POLICIES = Object.freeze({
  free: Object.freeze({ monthlyFeeCents: 0, ...POLICY }),
  premium: Object.freeze({ monthlyFeeCents: 24900, ...POLICY }),
});
function calculatePricing({ subtotalCents, planTier = 'free', commissionBps = 0,
  items = [{ unitPriceCents: subtotalCents, quantity: 1 }], currency = 'USD', costs, now, benchmark,feeMode = 'buyer' }) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new RangeError('Invalid subtotal');
  if (!Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 4000) throw new RangeError('Invalid commission');
  const quote = quoteOrder({ items, currency, costs, now, benchmark,feeMode,commissionBps });
  if (quote.subtotalCents !== subtotalCents) throw new RangeError('Item subtotal mismatch');
  if (!quote.eligible) throw new DomainError('This combination is not available at our current pricing. Try another offering or quantity.',
    { code: 'PRICING_UNAVAILABLE', status: 422 });
  // The legacy order fee column is the customer-facing added fee. The full
  // modeled fee and any business-absorbed portion live in the private snapshot.
  return { platformFeeCents: quote.buyerFeeCents ?? quote.feeCents, totalCents: quote.totalCents,
    affiliateCommissionCents: quote.commissionCents || 0,
    pricingPlanSnapshot: { tier: planTier, ...(PLAN_POLICIES[planTier] || PLAN_POLICIES.free),
      pricingDecision: quote } };
}
module.exports = { PLAN_POLICIES, roundBasisPoints, calculatePricing };
