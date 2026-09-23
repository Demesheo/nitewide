const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckoutService } = require('../src/services/checkout-service');

test('idempotent replay preserves historical fee amount and payer without repricing', async () => {
  const historical = { id: 'historical', subtotalCents: 10000, platformFeeCents: 829,
    totalCents: 10829, pricingPlanSnapshot: { percentageBps: 750, perPaidOrderCents: 79, processingPaidBy: 'organizer' } };
  const models = { Order: { findOne: async () => historical }, OrderItem: {} };
  const sequelize = { transaction: async (_options, run) => run({}) };
  const checkout = createCheckoutService({ sequelize, models });
  const result = await checkout({ buyerUserId: 'buyer', idempotencyKey: 'already-paid' });
  assert.equal(result.order, historical);
  assert.equal(result.order.totalCents, 10829);
  assert.equal(result.order.pricingPlanSnapshot.processingPaidBy, 'organizer');
  assert.equal(result.replayed, true);
  assert.deepEqual(result.credentials, []);
});
