const test = require('node:test'); const assert = require('node:assert/strict'); const { createCheckoutService } = require('../src/services/checkout-service');
function fixture({ sold = 0, total = 5, environment = 'development', hostedDemo = false } = {}) {
  let increments = 0; const offering = { id: '50000000-0000-4000-8000-000000000001', eventId: 'e1', name: 'GA', kind: 'ticket', priceCents: 2000, currency: 'USD', inventoryMode: 'finite', quantityTotal: total, quantitySold: sold, entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 4, isActive: true, increment: async (_field, { by }) => { increments += by; } };
  const created = { tickets: 0, payment: null }; const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const models = {
    Order: { findOne: async () => null, create: async (data) => ({ id: 'order-1', ...data }) },
    Event: { findByPk: async () => ({ id: 'e1', status: 'published', organizationId: 'o1' }) },
    Organization: { findByPk: async () => ({ planTier: 'free' }) }, Offering: { findAll: async () => [offering] }, EventAffiliate: {}, OrgAffiliate: {},
    OrderItem: { create: async (data) => ({ id: 'item-1', ...data }) }, Ticket: { create: async () => ({ id: `ticket-${++created.tickets}` }) },
    Payment: { create: async (data) => { created.payment = data; return data; } }, AffiliateAttribution: { create: async () => ({}) }, AuditLog: { create: async () => ({}) },
  };
  const sequelize = { transaction: async (_options, work) => work(tx) };
  return { checkout: createCheckoutService({ sequelize, models, environment, hostedDemo }), getIncrements: () => increments, created };
}
test('checkout snapshots a sale, increments inventory, and creates credentials', async () => {
  const f = fixture(); const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'unique-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 2 }], payment: { provider: 'test', reference: 'pay-1', status: 'succeeded' } });
  assert.equal(result.order.subtotalCents, 4000); assert.equal(result.order.platformFeeCents, 480); assert.equal(result.order.totalCents, 4480); assert.equal(result.order.pricingPlanSnapshot.processingPaidBy, 'platform'); assert.equal(f.created.payment.amountCents, 4480); assert.equal(f.getIncrements(), 2); assert.equal(result.credentials.length, 2);
});
test('checkout rejects inventory oversells before writing an order', async () => {
  const f = fixture({ sold: 4, total: 5 }); await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'unique-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 2 }], payment: { provider: 'test', reference: 'pay-1', status: 'succeeded' } }), (error) => error.code === 'INSUFFICIENT_INVENTORY'); assert.equal(f.getIncrements(), 0);
});
test('local demo checkout records a labeled order, payment and inventory movement', async () => {
  const f = fixture();
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'demo-key-1', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-1', status: 'succeeded' } });
  assert.equal(result.order.pricingPlanSnapshot.demo, true);
  assert.equal(result.order.affiliateCommissionCents, 0);
  assert.equal(f.created.payment.provider, 'demo');
  assert.equal(f.getIncrements(), 1);
  assert.equal(result.credentials.length, 1);
});
test('production does not accept demo checkout', async () => {
  const f = fixture({ environment: 'production' });
  await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'demo-key-1', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-1', status: 'succeeded' } }), { code: 'DEMO_DISABLED' });
  assert.equal(f.getIncrements(), 0);
});
test('protected hosted demo accepts mock sales while retaining production runtime', async () => {
  const f = fixture({ environment: 'production', hostedDemo: true });
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'hosted-demo', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-hosted', status: 'succeeded' } });
  assert.equal(result.order.pricingPlanSnapshot.demo, true);
  assert.equal(f.created.payment.provider, 'demo');
  assert.equal(f.getIncrements(), 1);
});
test('hosted demo rejects claimed live payments before any transaction writes', async () => {
  const f = fixture({ environment: 'production', hostedDemo: true });
  await assert.rejects(() => f.checkout({ payment: { provider: 'stripe', status: 'succeeded' } }), { code: 'DEMO_ONLY' });
  assert.equal(f.getIncrements(), 0);
  assert.equal(f.created.payment, null);
});
