// Keep in parity with the synchronous API pricing policy; tested across cent values.
// Stripe processing is paid separately by the organizer, not added to the buyer.
export function checkoutFeeCents(subtotalCents) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0)
    throw new RangeError("Subtotal must be non-negative integer cents");
  if (!subtotalCents) return 0;
  return Math.round(subtotalCents * 0.075) + 79;
}
