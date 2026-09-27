const test = require('node:test');
const assert = require('node:assert/strict');
const { queuePurchaseEmail, queueGuestlistEmail } = require('../src/services/email-events');
const { TEMPLATES } = require('../src/services/email-templates');

test('purchase and guestlist messages use the event venue timezone and link to the exact booking', async () => {
  const queued = [];
  const email = { enabled: true, queue: async (message) => queued.push(message) };
  const user = { id: 'user-1', email: 'guest@example.org', displayName: 'Guest' };
  const models = {
    User: { findByPk: async () => user },
    Location: { findByPk: async () => ({ timezone: 'America/Los_Angeles' }) },
  };
  const event = { id: 'event-1', title: 'Night One', locationId: 'location-1', startsAt: '2026-09-27T03:00:00.000Z' };
  await queuePurchaseEmail({ email, models, event, order: { id: 'order-1', totalCents: 2500 },
    lines: [{ offering: { name: 'Ticket' }, quantity: 2 }], buyerUserId: user.id,
    customerAppUrl: 'https://example.org', transaction: {}, demo: false });
  const entry = { id: 'entry-1', userId: user.id, partySize: 3 };
  await queueGuestlistEmail({ email, models, event,
    entry, kind: 'approved',
    customerAppUrl: 'https://example.org', transaction: {} });
  assert.equal(queued[0].template, TEMPLATES.purchaseReceipt);
  assert.equal(queued[1].template, TEMPLATES.guestlistApproved);
  assert.match(queued[0].variables.EVENT_DATE, /September 26, 2026/);
  assert.match(queued[1].variables.EVENT_DATE, /September 26, 2026/);
  assert.equal(queued[1].variables.SPOTS, '3');
  assert.equal(entry.partySize, 3);
  assert.equal(new URL(queued[0].variables.BOOKING_URL).searchParams.get('booking'), 'purchase:order-1');
  assert.equal(new URL(queued[1].variables.BOOKING_URL).searchParams.get('booking'), 'guestlist:entry-1');
});
