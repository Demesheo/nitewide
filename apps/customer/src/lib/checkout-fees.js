import pricing from '@nitewide/pricing';
export function checkoutQuote(unitPriceCents, quantity = 1, currency = 'USD', feeMode = 'buyer') {
  return pricing.publicQuote(pricing.quoteOrder({ items: [{ unitPriceCents, quantity, feeMode }], currency }));
}
export function checkoutFeeCents(unitPriceCents, quantity = 1) {
  return checkoutQuote(unitPriceCents, quantity).feeCents;
}
