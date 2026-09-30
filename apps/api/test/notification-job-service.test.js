const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationJobService, checkoutMessage } = require('../src/services/notification-job-service');
test('checkout enqueue requires its transaction and preserves one order dedupe key', async () => {
  const transaction = {}; let recorded;
  const service = createNotificationJobService({ sequelize: {}, models: { NotificationJob: { findOrCreate: async (options) => {
    recorded = options; return [{ id: 'job', ...options.defaults }];
  } } } });
  await assert.rejects(service.enqueueCheckout({ orderId: 'order' }), /requires its transaction/);
  await service.enqueueCheckout({ orderId: 'order' }, transaction);
  assert.equal(recorded.transaction, transaction); assert.deepEqual(recorded.where, { orderId: 'order' });
  assert.equal(recorded.defaults.status, 'pending');
});
test('notification concurrency and pass bounds are explicit and bounded', () => {
  for (const concurrency of [0,9,1.5]) assert.throws(() => createNotificationJobService({ sequelize: {}, models: {}, concurrency }), /concurrency/);
  const service = createNotificationJobService({ sequelize: {}, models: {} });
  assert.throws(() => service.drain({ maxJobs: 0 }), /bounds/);
  assert.throws(() => service.drain({ maxBatches: 101 }), /bounds/);
});
test('notification messages retain historical booking context and demo labels', () => {
  const payload = { orderId: 'order', eventId: 'event', eventTitle: 'Friday', names: '2 × GA', demo: true, subtotalCents: 2000, commissionCents: 200, referrerUserId: 'referrer' };
  const message = checkoutMessage(payload, { user_id: 'recipient', kind: 'event_purchase' }, { displayName: 'Buyer' }, { displayName: 'Promoter' });
  assert.equal(message.title, 'Demo event sale'); assert.match(message.message, /Promoter's customer/); assert.match(message.message, /demo only/);
  assert.equal(message.metadata.orderId, 'order');
});
