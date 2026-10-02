const { DomainError } = require('./errors');

const MINIMUM_COMMISSION_SUBTOTAL_CENTS = 1000;
const COMMISSION_SETTLEMENT_DELAY_MS = 48 * 60 * 60 * 1000;
function commissionMinimum(value = MINIMUM_COMMISSION_SUBTOTAL_CENTS) {
  if (!Number.isSafeInteger(value) || value < MINIMUM_COMMISSION_SUBTOTAL_CENTS || value > 100000000)
    throw new DomainError('Commission minimum must be at least $10.', { status: 422, code: 'INVALID_COMMISSION_MINIMUM' });
  return value;
}
function effectiveCommissionMinimum(event, organization) {
  return commissionMinimum(event?.commissionMinimumSubtotalCents ?? organization?.commissionMinimumSubtotalCents ?? MINIMUM_COMMISSION_SUBTOTAL_CENTS);
}
function commissionSnapshot({ event, organization, affiliate = {}, subtotalCents, currency = 'USD', now = new Date() }) {
  const minimumSubtotalCents = effectiveCommissionMinimum(event, organization);
  const eligibleSubtotal = Number.isSafeInteger(subtotalCents) && subtotalCents > 0 && subtotalCents >= minimumSubtotalCents;
  const configuredCommissionBps = affiliate.configuredCommissionBps ?? affiliate.commissionBps ?? 0;
  const effectiveCommissionBps = eligibleSubtotal && affiliate.commissionEligibility?.eligible === true ? affiliate.effectiveCommissionBps ?? affiliate.commissionBps ?? 0 : 0;
  return { version: 1, organizationId: event.organizationId || null, eventId: event.id, eventTitle: event.title,
    eventEndsAt: Number.isFinite(new Date(event.endsAt).getTime()) ? new Date(event.endsAt).toISOString() : null, recipientUserId: affiliate.eventAffiliate?.userId || affiliate.orgAffiliate?.userId || null,
    individualCommissionProfileId: affiliate.individualProfile?.id || null, stripeAccountId: affiliate.individualProfile?.stripeAccountId || null,
    providerMode: affiliate.individualProfile?.providerMode || null, configuredCommissionBps, effectiveCommissionBps,
    minimumSubtotalCents, eligibleSubtotalCents: eligibleSubtotal ? subtotalCents : 0,
    subtotalCents, currency, commissionEligibility: affiliate.commissionEligibility || null, capturedAt: new Date(now).toISOString() };
}
function proportionalRefund({ subtotalCents, totalCents, originalCommissionCents, cumulativeRefundedTotalCents }) {
  for (const value of [subtotalCents, totalCents, originalCommissionCents, cumulativeRefundedTotalCents])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid refund allocation');
  const refundedTotalCents = Math.min(totalCents, cumulativeRefundedTotalCents);
  // The provider refunds the customer total. Allocate fees/tax proportionally;
  // cumulative rounding makes retries and split refunds produce the same result.
  const refundedSubtotalCents = totalCents ? Number((BigInt(subtotalCents) * BigInt(refundedTotalCents) + BigInt(Math.floor(totalCents / 2))) / BigInt(totalCents)) : 0;
  const refundedCommissionCents = subtotalCents ? Math.min(originalCommissionCents, Number((BigInt(originalCommissionCents) * BigInt(refundedSubtotalCents) + BigInt(Math.floor(subtotalCents / 2))) / BigInt(subtotalCents))) : 0;
  return { refundedTotalCents, refundedSubtotalCents, refundedCommissionCents };
}
module.exports = { MINIMUM_COMMISSION_SUBTOTAL_CENTS, COMMISSION_SETTLEMENT_DELAY_MS, commissionMinimum, effectiveCommissionMinimum, commissionSnapshot, proportionalRefund };
