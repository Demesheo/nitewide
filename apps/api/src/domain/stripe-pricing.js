const { DomainError } = require('./errors');

// The combined customer fee covers modeled processing. Under direct charges,
// Stripe collects processing from the merchant; collecting it again in our
// application fee would double-charge the merchant. These are modeled costs,
// not a claim that any merchant's actual provider fees have been verified.
function stripeApplicationFee(pricing, mode = 'test') {
  if (!['test', 'live'].includes(mode)) throw new DomainError('Payment pricing is unavailable', { code: 'PRICING_UNAVAILABLE', status: 422 });
  const quote = pricing.pricingPlanSnapshot?.pricingDecision;
  const values = [pricing.totalCents, quote?.feeCents, quote?.processingCents, pricing.affiliateCommissionCents || 0];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new DomainError('Payment pricing is unavailable', { code: 'PRICING_UNAVAILABLE', status: 422 });
  const nitewideFeeCents = quote.feeCents - quote.processingCents;
  if (nitewideFeeCents < 0 || nitewideFeeCents > pricing.totalCents || pricing.totalCents > 0 && nitewideFeeCents < 100) {
    throw new DomainError('Payment pricing is unavailable', { code: 'PRICING_UNAVAILABLE', status: 422 });
  }
  return { applicationFeeCents: nitewideFeeCents, nitewideFeeCents, modeledProcessorFeeCents: quote.processingCents,
    commissionCents: pricing.affiliateCommissionCents || 0, commissionSettlement: 'merchant_obligation', economicsBasis: mode === 'live' ? 'modeled_provider_costs' : 'modeled_sandbox_costs' };
}
module.exports = { stripeApplicationFee };
