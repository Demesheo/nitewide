const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckoutService } = require('../src/services/checkout-service');

test('idempotent replay preserves historical fee amount and payer without repricing', async () => {
  const historical = { id: 'historical', eventId: 'historical-event', items: [{ offeringId: 'historical-offering', quantity: 2 }], subtotalCents: 10000, platformFeeCents: 829,
    totalCents: 10829, affiliateCommissionCents: 1000, pricingPlanSnapshot: { percentageBps: 750, perPaidOrderCents: 79, processingPaidBy: 'organizer', commissionBps: 1000 } };
  const models = { User: { findByPk: async () => ({ id: 'buyer', isActive: true }) }, Order: { findOne: async () => historical }, OrderItem: {} };
  const sequelize = { transaction: async (_options, run) => run({ LOCK: { UPDATE: 'UPDATE' } }) };
  const checkout = createCheckoutService({ sequelize, models });
  const result = await checkout({ buyerUserId: 'buyer', eventId: historical.eventId,
    items: [{ offeringId: 'historical-offering', quantity: 2 }], idempotencyKey: 'already-paid' });
  assert.equal(result.order, historical);
  assert.equal(result.order.totalCents, 10829);
  assert.equal(result.order.pricingPlanSnapshot.processingPaidBy, 'organizer');
  assert.equal(result.order.affiliateCommissionCents, 1000);
  assert.equal(result.order.pricingPlanSnapshot.commissionBps, 1000, 'eligibility changes cannot rewrite historical commission');
  assert.equal(result.replayed, true);
  assert.deepEqual(result.credentials, []);
});
