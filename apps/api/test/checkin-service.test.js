const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckInService } = require('../src/services/checkin-service');

function fixture(eventStartsAt, now) {
  const updates = [];
  const entry = { id: 'entry-1', status: 'confirmed', update: async (values) => { updates.push(values); Object.assign(entry, values); } };
  const service = createCheckInService({
    now: () => new Date(now),
    sequelize: { transaction: async (_options, callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) },
    models: {
      Ticket: { findOne: async () => null },
      GuestlistEntry: { findOne: async () => entry },
      Event: { findByPk: async () => ({ status: 'published', startsAt: new Date(eventStartsAt), endsAt: new Date(new Date(eventStartsAt).getTime() + 86400000) }) },
      CheckIn: { create: async (input) => input },
    },
  });
  return { service, updates, entry };
}

test('a future guestlist cannot be checked in before the event starts', async () => {
  const { service, updates } = fixture('2026-09-25T22:00:00Z', '2026-09-25T21:59:59Z');
  await assert.rejects(service({ eventId: 'event-1', qrToken: 'demo-token', checkedInByUserId: 'staff-1' }), { code: 'EVENT_NOT_STARTED' });
  assert.equal(updates.length, 0);
});

test('an approved guestlist can be checked in after the event starts', async () => {
  const { service, updates } = fixture('2026-09-25T22:00:00Z', '2026-09-25T22:00:00Z');
  const result = await service({ eventId: 'event-1', qrToken: 'demo-token', checkedInByUserId: 'staff-1' });
  assert.equal(result.kind, 'guestlist');
  assert.equal(updates[0].status, 'checked_in');
});
