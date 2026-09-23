const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { createNotificationService } = require('../src/services/notification-service');

test('legacy customer invitation links resolve to the recipient’s own guestlist entry', async () => {
  const rows = [{ id: 'notification', kind: 'guestlist_invited', eventId: 'event', metadata: {} }];
  const service = createNotificationService({
    Notification: { findAll: async ({ where }) => { assert.equal(where.userId, 'customer'); return rows; } },
    GuestlistEntry: { findAll: async ({ where }) => {
      assert.equal(where.userId, 'customer'); assert.deepEqual(where.eventId[Op.in], ['event']);
      return [{ id: 'own-entry', eventId: 'event' }];
    } },
  });
  assert.equal((await service.list('customer'))[0].metadata.entryId, 'own-entry');
  assert.deepEqual(rows[0].metadata, {}); // Read-time compatibility, no data mutation.
});
test('precise booking metadata is preserved and business notifications are not rewritten', async () => {
  const rows = [
    { kind: 'guestlist_approved', eventId: 'event', metadata: { entryId: 'exact-entry' } },
    { kind: 'purchase_confirmed', eventId: 'event', metadata: { orderId: 'exact-order' } },
    { kind: 'guestlist_request', eventId: 'event' },
  ];
  const service = createNotificationService({ Notification: { findAll: async () => rows } });
  assert.equal(await service.list('customer'), rows);
});
test('deleted legacy guestlist entries do not resolve to unrelated bookings', async () => {
  const row = { kind: 'guestlist_invited', eventId: 'deleted-event', metadata: {} };
  const service = createNotificationService({ Notification: { findAll: async () => [row] }, GuestlistEntry: { findAll: async () => [] } });
  assert.equal((await service.list('customer'))[0], row);
});
test('dismissal requires ownership and is idempotent', async () => {
  let updates = 0;
  const row = { readAt: null, dismissedAt: null, update: async values => { updates++; Object.assign(row, values); } };
  const service = createNotificationService({ Notification: { findOne: async ({ where }) => where.userId === 'owner' && where.id === 'notice' ? row : null } });
  await assert.rejects(service.dismiss('other', 'notice'), /not found/i);
  await service.dismiss('owner', 'notice'); await service.dismiss('owner', 'notice');
  assert.equal(updates, 1); assert.ok(row.dismissedAt); assert.ok(row.readAt);
});
test('clear all and unread counts are restricted to the current user and exclude dismissed rows', async () => {
  const service = createNotificationService({ Notification: {
    update: async (values, { where }) => { assert.equal(where.userId, 'owner'); assert.equal(where.dismissedAt[Op.is], null); assert.ok(values.dismissedAt); return [70]; },
    count: async ({ where }) => { assert.equal(where.userId, 'owner'); assert.equal(where.readAt[Op.is], null); assert.equal(where.dismissedAt[Op.is], null); return 0; },
  } });
  assert.deepEqual(await service.clearAll('owner'), { dismissed: 70 });
  assert.equal(await service.unreadCount('owner'), 0);
});
