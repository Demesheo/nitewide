const test = require('node:test');
const assert = require('node:assert/strict');
const { commissionSnapshot, proportionalRefund, commissionMinimum } = require('../src/domain/commission-policy');
const event = { id: 'event', organizationId: 'business', title: 'Night', endsAt: '2026-10-01T23:00:00Z' };
const affiliate = { configuredCommissionBps: 1250, commissionBps: 1250, effectiveCommissionBps: 1250,
  commissionEligibility: { eligible: true }, eventAffiliate: { userId: 'person' }, individualProfile: { id: 'profile', stripeAccountId: 'acct_individual', providerMode: 'test' } };
test('order subtotal threshold includes combined paid lines and excludes all free orders', () => {
  for (const [subtotalCents, expected] of [[0, 0], [999, 0], [1000, 1250], [2 * 600, 1250]]) {
    const snapshot = commissionSnapshot({ event, affiliate, subtotalCents });
    assert.equal(snapshot.effectiveCommissionBps, expected);
    assert.equal(snapshot.minimumSubtotalCents, 1000);
    assert.equal(snapshot.configuredCommissionBps, 1250);
  }
});
test('future order snapshot uses event override, organization default, and eligibility independently', () => {
  const snapshot = commissionSnapshot({ event, organization: { commissionMinimumSubtotalCents: 2500 }, affiliate, subtotalCents: 2000 });
  assert.equal(snapshot.effectiveCommissionBps, 0);
  assert.equal(snapshot.minimumSubtotalCents, 2500);
  event.commissionMinimumSubtotalCents = 1500;
  const overridden = commissionSnapshot({ event, organization: { commissionMinimumSubtotalCents: 2500 }, affiliate, subtotalCents: 2000 });
  assert.equal(overridden.effectiveCommissionBps, 1250);
  assert.equal(snapshot.minimumSubtotalCents, 2500, 'earlier terms remain frozen');
  delete event.commissionMinimumSubtotalCents;
  assert.equal(commissionSnapshot({ event, affiliate: { ...affiliate, commissionEligibility: { eligible: false } }, subtotalCents: 5000 }).effectiveCommissionBps, 0);
  assert.throws(() => commissionMinimum(999), { code: 'INVALID_COMMISSION_MINIMUM' });
});
test('cumulative refund proportions exclude fee share, round once, and cap the original', () => {
  assert.deepEqual(proportionalRefund({ subtotalCents: 1000, totalCents: 1200, originalCommissionCents: 125, cumulativeRefundedTotalCents: 600 }),
    { refundedTotalCents: 600, refundedSubtotalCents: 500, refundedCommissionCents: 63 });
  assert.deepEqual(proportionalRefund({ subtotalCents: 1000, totalCents: 1200, originalCommissionCents: 125, cumulativeRefundedTotalCents: 5000 }),
    { refundedTotalCents: 1200, refundedSubtotalCents: 1000, refundedCommissionCents: 125 });
});
