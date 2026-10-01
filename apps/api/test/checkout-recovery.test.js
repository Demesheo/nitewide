const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommerceController } = require('../src/controllers/commerce-controller');
const { buildContract } = require('../src/http/contract-build');

test('checkout recovery queries only the authenticated buyer and returns minimal order metadata', async () => {
  let query;
  const controller = createCommerceController({ models: { Order: { findOne: async (value) => { query = value; return { id: 'order-1', status: 'paid', buyerUserId: 'buyer-1', items: ['private'], requestFingerprint: 'private' }; } } } });
  let response;
  await controller.getCheckoutAttempt({ userId: 'buyer-1', params: { idempotencyKey: 'lost-response-key' } }, { json: (value) => { response = value; } });
  assert.deepEqual(query, { where: { buyerUserId: 'buyer-1', idempotencyKey: 'lost-response-key' }, attributes: ['id', 'status'] });
  assert.deepEqual(response, { data: { orderId: 'order-1', status: 'paid' } });
});

test('another buyer cannot resolve a checkout key and absence is 404', async () => {
  const controller = createCommerceController({ models: { Order: { findOne: async ({ where }) => where.buyerUserId === 'owner' ? { id: 'order-1', status: 'paid' } : null } } });
  await assert.rejects(() => controller.getCheckoutAttempt({ userId: 'other', params: { idempotencyKey: 'lost-response-key' } }, {}), { status: 404, code: 'NOT_FOUND' });
});

test('checkout recovery rejects invalid keys before reading orders', async () => {
  const controller = createCommerceController({ models: { Order: { findOne: async () => { throw new Error('Must not read'); } } } });
  await assert.rejects(() => controller.getCheckoutAttempt({ userId: 'buyer-1', params: { idempotencyKey: 'short' } }, {}), (error) => error.name === 'ZodError');
});

test('checkout recovery contract requires authentication and validates its minimal response', () => {
  const contract = buildContract().contracts.find(({ path }) => path === '/customer/checkout-attempts/:idempotencyKey');
  assert.equal(contract.authenticated, true);
  assert.equal(contract.paramsSchema.safeParse({ idempotencyKey: 'lost-response-key' }).success, true);
});
