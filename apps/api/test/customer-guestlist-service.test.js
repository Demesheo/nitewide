const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerAccountService } = require('../src/services/customer-account-service');

function fixture(partySize = 2) {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } }, audits = [];
  const event = { id: 'event-1', organizationId: 'org-1', status: 'published', endsAt: new Date(Date.now() + 86400000) };
  const entry = { id: 'entry-1', eventId: event.id, userId: 'customer-1', status: 'pending', partySize,
    update: async (changes, options) => { assert.equal(options.transaction, transaction); Object.assign(entry, changes); } };
  const models = {
    User: { findByPk: async () => ({ isActive: true }) },
    Organization: { findByPk: async () => ({ status: 'active' }) },
    Event: { findByPk: async (_id, options) => { if (options) { assert.equal(options.transaction, transaction); assert.equal(options.lock, transaction.LOCK.UPDATE); } return event; } },
    GuestlistEntry: {
      sequelize: { transaction: async (_options, work) => work(transaction) },
      findOne: async ({ where, attributes, transaction: lockedTransaction, lock }) => {
        if (where.userId !== entry.userId) return null;
        if (lockedTransaction && !attributes) assert.equal(lock, transaction.LOCK.UPDATE);
        return entry;
      },
    },
    AuditLog: { create: async (data, options) => { assert.equal(options.transaction, transaction); audits.push(data); } },
  };
  return { service: createCustomerAccountService({ models }), entry, audits };
}

test('pending guestlist edits enforce the customer one-through-five range in the domain', async () => {
  const { service, entry, audits } = fixture();
  for (const partySize of [undefined, null, '2', 0, -1, 1.5, 6, 20, NaN, Infinity]) {
    await assert.rejects(service.updatePendingGuestlist(entry.userId, entry.id, partySize), { code: 'INVALID_GUESTLIST_PARTY_SIZE', status: 422 });
    assert.equal(entry.partySize, 2); assert.equal(audits.length, 0);
  }
  for (const partySize of [1, 5]) assert.equal((await service.updatePendingGuestlist(entry.userId, entry.id, partySize)).entry.partySize, partySize);
  assert.deepEqual(audits.map((audit) => [audit.before.partySize, audit.after.partySize]), [[2, 1], [1, 5]]);
  await service.updatePendingGuestlist(entry.userId, entry.id, 5);
  assert.equal(audits.length, 2, 'an unchanged quantity does not add an audit');
});

test('legacy pending requests keep their quantity when read but expose the current five-spot request limit', async () => {
  const { service, entry, audits } = fixture(20);
  const status = await service.guestlistStatus(entry.userId, entry.eventId);
  assert.equal(status.maxPartySize, 5); assert.equal(status.entry.partySize, 20); assert.equal(status.requestsOpen, true);
  assert.equal(entry.partySize, 20); assert.equal(audits.length, 0);
  await service.updatePendingGuestlist(entry.userId, entry.id, 5);
  assert.deepEqual(audits[0].before, { partySize: 20 });
  assert.deepEqual(audits[0].after, { partySize: 5 });
});

test('pending controls remain customer-scoped and cannot change an approval', async () => {
  const { service, entry, audits } = fixture();
  await assert.rejects(service.updatePendingGuestlist('other', entry.id, 4), { code: 'NOT_FOUND' });
  entry.status = 'confirmed';
  await assert.rejects(service.updatePendingGuestlist(entry.userId, entry.id, 4), { code: 'GUESTLIST_NOT_EDITABLE' });
  assert.equal(entry.partySize, 2); assert.equal(audits.length, 0);
});
