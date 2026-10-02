const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('isolated commission ledger preserves purchase history, handles order-only holds, refunds and concurrent allocations', async () => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createCommissionLedgerService } = require('../src/services/commission-ledger-service');
  const { commissionSnapshot } = require('../src/domain/commission-policy');
  const { persistedCommissionTerms, commissionEligibilitySql } = require('../src/services/commission-profile-repository');
  const { configuredCommissionBps } = require('../src/domain/editor-pricing-policy');
  const sequelize = createSequelize(getConfig()); const models = initModels(sequelize);
  const current = new Date('2026-10-10T12:00:00Z');
  const service = createCommissionLedgerService({ sequelize, models, now: () => current });
  try {
    await sequelize.authenticate();
    const owner = await models.User.create({ displayName: 'Ledger owner', email: `${randomUUID()}@ledger.test` });
    const person = await models.User.create({ displayName: 'Ledger person', email: `${randomUUID()}@ledger.test` });
    const buyer = await models.User.create({ displayName: 'Ledger buyer', email: `${randomUUID()}@ledger.test` });
    const org = await models.Organization.create({ name: 'Ledger business', slug: `ledger-${randomUUID()}` });
    const other = await models.Organization.create({ name: 'Other ledger business', slug: `ledger-${randomUUID()}` });
    const event = await models.Event.create({ title: 'Ledger night', slug: `ledger-${randomUUID()}`, organizationId: org.id,
      creatorUserId: owner.id, status: 'published', startsAt: '2026-10-01T10:00:00Z', endsAt: '2026-10-01T12:00:00Z' });
    const profile = await models.IndividualCommissionProfile.create({ userId: person.id, name: 'Personal account', creationRequestId: randomUUID(),
      stripeAccountId: `acct_${randomUUID()}`, verifiedAt: current, verifiedStripeAccount: {
        object: 'v2.core.account', livemode: false, identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
        configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] },
      } });
    await profile.update({ verifiedStripeAccount: { ...profile.verifiedStripeAccount, id: profile.stripeAccountId } });
    const sqlEligibility = async () => {
      const [row] = await sequelize.query(`SELECT (${commissionEligibilitySql('cp')}) AS ready FROM individual_commission_profiles cp WHERE cp.id=:id`,
        { replacements: { id: profile.id, commissionNow: current }, type: require('sequelize').QueryTypes.SELECT });
      return row.ready;
    };
    assert.equal(await sqlEligibility(), true);
    const originalEvidence = profile.verifiedStripeAccount;
    await profile.update({ verifiedStripeAccount: { ...originalEvidence, configuration: { merchant: { ...originalEvidence.configuration.merchant, applied: '2026-10-01T00:00:00Z' } } } });
    assert.equal(await sqlEligibility(), true);
    await profile.update({ verifiedStripeAccount: { ...originalEvidence, configuration: { merchant: { ...originalEvidence.configuration.merchant, applied: 'invalid' } } } });
    assert.equal(await sqlEligibility(), false);
    await profile.update({ verifiedStripeAccount: originalEvidence });
    const affiliate = await models.OrgAffiliate.create({ organizationId: org.id, userId: person.id, code: `LEDGER-${randomUUID()}`, defaultCommissionBps: 2500 });
    const assignment = await models.EventAffiliate.create({ eventId: event.id, userId: person.id, orgAffiliateId: affiliate.id, code: `LEDGER-${randomUUID()}`, commissionBps: 0 });
    assert.equal(await configuredCommissionBps({ models, eventId: event.id, organizationId: org.id, now: current }), 0, 'event zero overrides the default');
    await assignment.update({ commissionBps: null });
    assert.equal(await configuredCommissionBps({ models, eventId: event.id, organizationId: org.id, now: current }), 2500);
    const terms = await persistedCommissionTerms(models, person.id, 2500, { now: current });
    assert.equal(terms.effectiveCommissionBps, 2500);
    const snapshot = commissionSnapshot({ event, organization: org, affiliate: { ...terms,
      eventAffiliate: { userId: person.id }, individualProfile: profile }, subtotalCents: 2000, now: current });
    const makeOrder = (commission = true) => models.Order.create({ buyerUserId: buyer.id, eventId: event.id, status: 'paid',
      providerMode: 'test', providerVerificationStatus: 'verified', stripePaymentIntentId: `pi_${randomUUID()}`, currency: 'USD',
      subtotalCents: 2000, totalCents: 2200, platformFeeCents: 200, affiliateCommissionCents: 500,
      commissionSnapshot: commission ? snapshot : {}, idempotencyKey: randomUUID(), paidAt: current });
    const orders = await Promise.all([makeOrder(), makeOrder(), makeOrder(false)]);
    for (const order of orders) await service.recordPaidOrder({ order, event });
    await service.recordPaidOrder({ order: orders[0], event });
    assert.equal(await models.CommissionEarning.count(), 2, 'only purchase-snapshotted verified orders earn, once each');
    await assert.rejects(orders[0].update({ affiliateCommissionCents: 1 }), /immutable/);
    await orders[0].reload();
    const earning = await models.CommissionEarning.findOne({ where: { orderId: orders[0].id } });
    await assert.rejects(earning.update({ originalCommissionCents: 1 }), /immutable/);
    await assert.rejects(earning.destroy(), /cannot be deleted/);
    await service.setRefundHold({ orderId: orders[0].id, hold: true });
    const listing = await service.listStatements({ organizationId: org.id });
    assert.equal(listing.total, 1); assert.equal(listing.rows[0].heldCommissionCents, 500); assert.equal(listing.rows[0].payableCommissionCents, 500);
    await service.setDisputeHold({ orderId: orders[0].id, hold: true });
    await service.setRefundHold({ orderId: orders[0].id, hold: false });
    assert.equal((await models.CommissionEarning.findByPk(earning.id)).disputeHold, true, 'refund denial cannot release a dispute hold');
    assert.equal((await service.listStatements({ organizationId: org.id })).rows[0].heldCommissionCents, 500);
    assert.equal((await service.listStatements({ organizationId: other.id })).rows.length, 0);
    const statementIds = [listing.rows[0].id];
    await event.update({ endsAt: '2026-10-09T12:00:00Z' });
    assert.equal((await service.listStatements({ organizationId: org.id })).rows[0].payableCommissionCents, 0);
    await assert.rejects(service.approveStatements({ organizationId: org.id, recipientUserId: person.id, currency: 'USD', statementIds, approvedByUserId: owner.id }), { code: 'COMMISSION_SETTLEMENT_PENDING' });
    await event.update({ endsAt: '2026-10-01T12:00:00Z' });
    await assert.rejects(service.summarizeStatements({ organizationId: other.id, statementIds }), { code: 'NOT_FOUND' });
    const detail = await service.statementDetails({ recipientUserId: person.id, statementId: statementIds[0], pageSize: 1 });
    assert.equal(detail.rows.length, 1); assert.equal(detail.total, 2);
    const selection = { organizationId: org.id, recipientUserId: person.id, currency: 'USD', statementIds, approvedByUserId: owner.id };
    await service.approveStatements(selection);
    const payment = async (commissionCents = 500) => models.CommissionPayment.create({ organizationId: org.id, recipientUserId: person.id,
      individualCommissionProfileId: profile.id, stripeAccountId: profile.stripeAccountId, currency: 'USD', commissionCents, feeAllowanceCents: 100,
      totalCents: commissionCents + 100, feePolicy: {}, statementSnapshot: {}, paymentMethod: 'card', idempotencyKey: randomUUID(), approvalHash: 'a'.repeat(64),
      approvedByUserId: owner.id, approvedAt: current });
    const attempts = await Promise.all([payment(), payment()]);
    const concurrent = await Promise.allSettled(attempts.map((p) => service.reserveStatements({ ...selection, paymentId: p.id })));
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((r) => r.status === 'rejected').reason.code, 'NO_PAYABLE_COMMISSION');
    const winning = attempts[concurrent.findIndex((r) => r.status === 'fulfilled')];
    await service.finishPayment({ paymentId: winning.id, paid: true });
    await service.finishPayment({ paymentId: winning.id, paid: true });
    await service.adjustRefund({ order: orders[1], refundId: randomUUID(), cumulativeRefundedTotalCents: 1100 });
    await service.adjustRefund({ order: orders[1], cumulativeRefundedTotalCents: 1100 });
    const paid = await models.CommissionEarning.findOne({ where: { orderId: orders[1].id } });
    assert.equal(paid.originalCommissionCents, 500); assert.equal(paid.paidCommissionCents, 500); assert.equal(paid.businessLossCents, 250);
    assert.equal(orders[1].refundedSubtotalCents, 1000);
    await service.setDisputeHold({ orderId: orders[0].id, hold: false });
    await service.adjustRefund({ order: orders[0], cumulativeRefundedTotalCents: 2196 });
    const residual = await models.CommissionEarning.findOne({ where: { orderId: orders[0].id } });
    assert.equal(residual.unpaidCommissionCents, 1, 'tiny outstanding balances remain payable and never expire');
    const residualPayment = await payment();
    assert.equal((await service.reserveStatements({ ...selection, paymentId: residualPayment.id })).amountCents, 1);
    await service.adjustRefund({ order: orders[0], cumulativeRefundedTotalCents: 2200 });
    await residualPayment.reload();
    assert.ok(residualPayment.invalidatedAt); assert.equal(residualPayment.invalidationReason, 'purchase_refund');
    assert.equal((await models.CommissionEarning.findByPk(residual.id)).businessLossCents, 1);
    await service.finishPayment({ paymentId: residualPayment.id, paid: false });
    const released = await models.CommissionEarning.findByPk(residual.id);
    assert.equal(released.reservedCommissionCents, 0); assert.equal(released.unpaidCommissionCents, 0); assert.equal(released.businessLossCents, 0);
    const partialOrders = await Promise.all([makeOrder(), makeOrder()]);
    for (const order of partialOrders) await service.recordPaidOrder({ order, event });
    const partialPayment = await payment(1000);
    assert.equal((await service.reserveStatements({ ...selection, paymentId: partialPayment.id })).amountCents, 1000);
    const partialResult = await service.finishPayment({ paymentId: partialPayment.id, paid: true, settledAmountCents: 751 });
    assert.equal(partialResult.settledAmountCents, 751); assert.equal(partialResult.releasedAmountCents, 249);
    assert.equal(partialResult.remainingCommissionCents, 249);
    const partialAllocations = await models.CommissionAllocation.findAll({ where: { paymentId: partialPayment.id } });
    assert.equal(partialAllocations.reduce((sum, a) => sum + a.paidAmountCents, 0), 751);
    assert.deepEqual(partialAllocations.map(a => a.amountCents), [500, 500]);
    await assert.rejects(partialAllocations[0].update({ amountCents: 1 }), /immutable/);
    await assert.rejects(partialAllocations[0].update({ paidAmountCents: 1 }), /immutable/);
    await service.finishPayment({ paymentId: partialPayment.id, paid: true, settledAmountCents: 751 });
    await assert.rejects(service.finishPayment({ paymentId: partialPayment.id, paid: true, settledAmountCents: 750 }), { code: 'COMMISSION_PAYMENT_RESOLVED' });
    const partialEarnings = await models.CommissionEarning.findAll({ where: { orderId: partialOrders.map(o => o.id) } });
    assert.equal(partialEarnings.reduce((sum, e) => sum + e.paidCommissionCents, 0), 751);
    assert.equal(partialEarnings.reduce((sum, e) => sum + e.unpaidCommissionCents, 0), 249);
    const residualApproval = await payment(249);
    assert.equal((await service.reserveStatements({ ...selection, paymentId: residualApproval.id })).amountCents, 249, 'residual requires a distinct durable approval');
    await service.finishPayment({ paymentId: residualApproval.id, paid: false });
    await profile.update({ paymentsDisabledAt: current });
    assert.equal((await persistedCommissionTerms(models, person.id, 2500, { now: current })).effectiveCommissionBps, 0);
    assert.equal((await models.CommissionEarning.findByPk(paid.id)).paidCommissionCents, 500, 'later account or membership changes cannot claw back paid history');
  } finally { await sequelize.close(); }
});
