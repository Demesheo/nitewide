const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommissionLedgerService } = require('../src/services/commission-ledger-service');
const { Op } = require('sequelize');
const now = new Date('2026-10-04T12:00:00Z');
const record = (data) => Object.assign(data, { update: async function (values) { Object.assign(this, values); return this; } });
function fixture({ ended = '2026-10-01T10:00:00Z' } = {}) {
  const events = [record({ id: 'event', endsAt: ended })];
  const statements = [record({ id: 'statement', eventId: 'event', eventTitle: 'Night', organizationId: 'org', recipientUserId: 'recipient', currency: 'USD', availableAt: new Date(new Date(ended).getTime() + 48 * 3600000) })];
  const earnings = ['one', 'two'].map((id) => record({ id, orderId: id, statementId: 'statement', originalCommissionCents: 100,
    unpaidCommissionCents: 100, paidCommissionCents: 0, reservedCommissionCents: 0, refundedCommissionCents: 0, businessLossCents: 0, refundHold: false, disputeHold: false, snapshot: { recipientUserId: 'recipient' } }));
  const allocations = [];
  const payments = [record({ id: 'payment', status: 'awaiting_payment', reconciliationToken: 'inflight-proof' })];
  const matches = (row, where) => Object.entries(where || {}).every(([key, value]) => value && typeof value === 'object' && value[Op.in] ? value[Op.in].includes(row[key]) : row[key] === value);
  const models = {
    Event: { findAll: async ({ where }) => events.filter((row) => matches(row, where)) },
    CommissionStatement: { findAll: async ({ where }) => statements.filter((row) => matches(row, where)) },
    CommissionEarning: { findOne: async ({ where }) => earnings.find((row) => matches(row, where)), findAll: async ({ where }) => earnings.filter((row) => matches(row, where)) },
    CommissionAllocation: { findAll: async ({ where }) => allocations.filter((row) => matches(row, where)), create: async (values) => { const row = record({ id: `allocation-${allocations.length}`, ...values, status: 'reserved' }); allocations.push(row); return row; } },
    CommissionPayment: { findAll: async ({ where }) => payments.filter((row) => matches(row, where)) },
  };
  const sequelize = { transaction: async (_options, work) => work({ LOCK: { SHARE: 'SHARE', UPDATE: 'UPDATE' } }) };
  const service = createCommissionLedgerService({ sequelize, models, now: () => now });
  const input = { organizationId: 'org', recipientUserId: 'recipient', currency: 'USD', statementIds: ['statement'], approvedByUserId: 'owner', paymentId: 'payment' };
  const order = (id) => record({ id, subtotalCents: 1000, totalCents: 1200, affiliateCommissionCents: 100 });
  return { service, input, statements, earnings, allocations, payments, order };
}
test('maturity and statement approval precede durable commission reservations', async () => {
  const f = fixture({ ended: '2026-10-03T12:00:00Z' });
  await assert.rejects(f.service.approveStatements(f.input), { code: 'COMMISSION_SETTLEMENT_PENDING' });
  assert.equal(f.allocations.length, 0);
  const mature = fixture();
  await assert.rejects(mature.service.reserveStatements(mature.input), { code: 'COMMISSION_STATEMENT_NOT_APPROVED' });
  await mature.service.approveStatements(mature.input);
  const first = await mature.service.reserveStatements(mature.input);
  const replay = await mature.service.reserveStatements(mature.input);
  assert.equal(first.amountCents, 200);
  assert.equal(replay.amountCents, 200);
  assert.equal(mature.allocations.length, 2);
  assert.equal(first.statements[0].earnings.length, 2);
});
test('a refund request holds only its order and leaves other payable earnings available', async () => {
  const f = fixture();
  await f.service.setRefundHold({ orderId: 'one', hold: true });
  await f.service.approveStatements(f.input);
  const reserved = await f.service.reserveStatements(f.input);
  assert.equal(reserved.amountCents, 100);
  assert.equal(reserved.allocations[0].earningId, 'two');
  assert.equal(f.earnings[0].unpaidCommissionCents, 100);
});
test('cumulative partial refunds adjust unpaid once and never modify original earnings', async () => {
  const f = fixture(); const order = f.order('one');
  await f.service.adjustRefund({ order, cumulativeRefundedTotalCents: 600 });
  await f.service.adjustRefund({ order, cumulativeRefundedTotalCents: 600 });
  assert.equal(f.earnings[0].unpaidCommissionCents, 50);
  assert.equal(f.earnings[0].originalCommissionCents, 100);
  assert.equal(order.refundedSubtotalCents, 500);
  await f.service.adjustRefund({ order, cumulativeRefundedTotalCents: 1200 });
  assert.equal(f.earnings[0].unpaidCommissionCents, 0);
  assert.equal(f.earnings[0].refundedCommissionCents, 100);
});
test('paid commission is unchanged after refunds and its reduction becomes business loss', async () => {
  const f = fixture();
  await f.service.approveStatements(f.input); await f.service.reserveStatements(f.input);
  await f.service.finishPayment({ paymentId: 'payment', paid: true });
  await f.service.finishPayment({ paymentId: 'payment', paid: true });
  await f.service.adjustRefund({ order: f.order('one'), cumulativeRefundedTotalCents: 1200 });
  assert.equal(f.earnings[0].paidCommissionCents, 100);
  assert.equal(f.earnings[0].businessLossCents, 100);
  assert.equal(f.earnings[0].unpaidCommissionCents, 0);
  await assert.rejects(f.service.finishPayment({ paymentId: 'payment', paid: false }), { code: 'COMMISSION_PAYMENT_RESOLVED' });
});
test('refunds while payment is reserved reconcile upon release without losing small balances', async () => {
  const f = fixture();
  await f.service.approveStatements(f.input); await f.service.reserveStatements(f.input);
  await f.service.adjustRefund({ order: f.order('one'), cumulativeRefundedTotalCents: 600 });
  assert.equal(f.payments[0].invalidationReason, 'purchase_refund');
  assert.equal(f.payments[0].reconciliationToken, null);
  assert.equal(f.earnings[0].reservedCommissionCents, 100);
  assert.equal(f.earnings[0].businessLossCents, 50);
  await f.service.finishPayment({ paymentId: 'payment', paid: false });
  assert.equal(f.earnings[0].unpaidCommissionCents, 50);
  assert.equal(f.earnings[0].businessLossCents, 0);
  assert.equal(f.earnings[1].unpaidCommissionCents, 100);
  await f.service.finishPayment({ paymentId: 'payment', paid: false });
  const next = await f.service.reserveStatements({ ...f.input, paymentId: 'another-payment' });
  assert.equal(next.amountCents, 150);
});
test('dispute holds survive refund denial, block only affected earnings and invalidate uncollected invoices', async () => {
  const f = fixture();
  await f.service.setRefundHold({ orderId: 'one', hold: true });
  await f.service.setDisputeHold({ orderId: 'one', hold: true });
  await f.service.setRefundHold({ orderId: 'one', hold: false });
  assert.equal(f.earnings[0].disputeHold, true);
  await f.service.approveStatements(f.input);
  assert.equal((await f.service.reserveStatements(f.input)).amountCents, 100);
  await f.service.setDisputeHold({ orderId: 'two', hold: true });
  assert.equal(f.payments[0].invalidationReason, 'purchase_dispute');
  assert.equal(f.payments[0].reconciliationToken, null);
  await f.service.finishPayment({ paymentId: 'payment', paid: false });
  await assert.rejects(f.service.reserveStatements({ ...f.input, paymentId: 'another' }), { code: 'NO_PAYABLE_COMMISSION' });
  await f.service.setDisputeHold({ orderId: 'one', hold: false });
  assert.equal((await f.service.reserveStatements({ ...f.input, paymentId: 'another' })).amountCents, 100);
});
test('provider-confirmed funds are not invalidated as uncollected on purchase refund', async () => {
  const f = fixture();
  await f.service.approveStatements(f.input); await f.service.reserveStatements(f.input);
  Object.assign(f.payments[0], { status: 'paid_fee_review', providerVerificationStatus: 'verified', providerChargeId: 'ch_confirmed', providerBalanceTransactionId: 'txn_confirmed' });
  await f.service.adjustRefund({ order: f.order('one'), cumulativeRefundedTotalCents: 600 });
  assert.equal(f.payments[0].invalidatedAt, undefined);
  assert.equal(f.earnings[0].businessLossCents, 50);
});
test('partial net settlement credits exact proportional cents and restores only unrefunded residual for fresh approval', async () => {
  const f = fixture();
  await f.service.approveStatements(f.input); await f.service.reserveStatements(f.input);
  await f.service.adjustRefund({ order: f.order('one'), cumulativeRefundedTotalCents: 600 });
  const result = await f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: 151 });
  assert.equal(result.remainingCommissionCents, 24, 'refunded unreceived amount is not payable residual');
  assert.deepEqual(f.allocations.map(a => a.amountCents), [100, 100], 'original approved amounts remain intact');
  assert.deepEqual(f.allocations.map(a => a.paidAmountCents), [75, 76], 'all 151 cents are allocated, never rounded away');
  assert.deepEqual(f.earnings.map(e => e.reservedCommissionCents), [0, 0]);
  assert.deepEqual(f.earnings.map(e => e.unpaidCommissionCents), [0, 24], 'refunded residual does not reappear');
  assert.deepEqual(f.earnings.map(e => e.businessLossCents), [25, 0]);
  await f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: 151 });
  await assert.rejects(f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: 150 }), { code: 'COMMISSION_PAYMENT_RESOLVED' });
  assert.equal((await f.service.reserveStatements({ ...f.input, paymentId: 'fresh-residual-approval' })).amountCents, 24);
});
test('a known zero net releases unreceived entitlement, but excessive or negative settlement never mutates', async () => {
  const f = fixture(); await f.service.approveStatements(f.input); await f.service.reserveStatements(f.input);
  await assert.rejects(f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: 201 }), RangeError);
  await assert.rejects(f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: -1 }), RangeError);
  assert.equal(f.earnings[0].reservedCommissionCents, 100);
  await f.service.finishPayment({ paymentId: 'payment', paid: true, settledAmountCents: 0 });
  assert.deepEqual(f.allocations.map(a => a.paidAmountCents), [0, 0]);
  assert.equal((await f.service.reserveStatements({ ...f.input, paymentId: 'fresh' })).amountCents, 200);
});
