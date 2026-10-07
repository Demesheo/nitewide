import pricing from '@nitewide/pricing';
export function checkoutQuote(unitPriceCents, quantity = 1, currency = 'USD', feeMode = 'buyer') {
  const quote = pricing.quoteOrder({ items: [{ unitPriceCents, quantity, feeMode }], currency });
  // Disclose only the fee the organizer covers, not their proceeds, commission,
  // provider costs or platform margin. This is itemization, not an added charge.
  return { ...pricing.publicQuote(quote), includedFeeCents: quote.eligible ? quote.businessFeeCents || 0 : null };
}
export function checkoutFeeCents(unitPriceCents, quantity = 1) {
  return checkoutQuote(unitPriceCents, quantity).feeCents;
}
