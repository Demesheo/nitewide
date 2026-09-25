const test = require('node:test');
const assert = require('node:assert/strict');
const { walletToken, verifyWalletToken } = require('../src/domain/wallet-qr');
const { guestlistWalletToken, verifyGuestlistWalletToken } = require('../src/domain/wallet-qr');
const { createCustomerAccountService } = require('../src/services/customer-account-service');
const { createCheckInService } = require('../src/services/checkin-service');
const secret = 'test-wallet-secret-not-a-production-key';
const ticket = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', holderUserId: 'customer-a', eventId: 'event-a', orderItemId: 'item-a', qrTokenHash: 'legacy-seeded-token-hash', status: 'valid' };
test('approved guest list passes are customer-scoped and bind the approved party and current credential', async () => {
  const entry = { id: ticket.id, userId: 'customer-a', eventId: 'event-a', partySize: 3, status: 'confirmed', qrTokenHash: 'approved-hash', event: { status: 'published', endsAt: new Date(Date.now() + 86400000) } };
  const token = guestlistWalletToken(entry, secret);
  assert.equal(verifyGuestlistWalletToken(token, entry, secret), true);
  for (const field of ['userId', 'eventId', 'partySize', 'qrTokenHash']) assert.equal(verifyGuestlistWalletToken(token, { ...entry, [field]: 'changed' }, secret), false);
  const service = createCustomerAccountService({ tokenSecret: secret, models: { GuestlistEntry: { findOne: async ({ where }) => where.userId === entry.userId ? entry : null } } });
  const pass = await service.guestlistPass(entry.userId, entry.id);
  assert.equal(pass.kind, 'guestlist'); assert.equal(pass.partySize, 3);
  assert.match(pass.tickets[0].qrImage, /^data:image\/png;base64,/);
  assert.equal(pass.tickets[0].offering, 'Guest list entry');
  await assert.rejects(service.guestlistPass('other', entry.id), { code: 'NOT_FOUND' });
  for (const status of ['pending', 'rejected', 'no_show']) { entry.status = status; assert.equal((await service.guestlistPass(entry.userId, entry.id)).tickets[0].qrImage, null); }
});
test('guest list wallet QR checks in the approved party once and revocation invalidates it', async () => {
  const entry = { id: ticket.id, userId: 'customer-a', eventId: 'event-a', partySize: 3, status: 'confirmed', qrTokenHash: 'approved-hash', update: async (values) => Object.assign(entry, values) };
  const token = guestlistWalletToken(entry, secret);
  const service = createCheckInService({ tokenSecret: secret, now: () => new Date('2026-09-22T12:00:00Z'), sequelize: { transaction: async (_opts, callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) }, models: {
    User: { findByPk: async () => ({ displayName: 'Guest' }) },
    Ticket: { findOne: async () => null }, GuestlistEntry: { findOne: async ({ where }) => where.eventId === entry.eventId ? entry : null },
    Event: { findByPk: async () => ({ status: 'published', startsAt: '2026-09-22T00:00:00Z', endsAt: '2026-09-23T00:00:00Z' }) }, CheckIn: { create: async (input) => input },
  } });
  const scan = (qrToken = token, eventId = entry.eventId) => service({ qrToken, eventId, checkedInByUserId: 'staff' });
  await assert.rejects(scan(token, 'wrong-event'), { code: 'INVALID_CREDENTIAL' });
  await assert.rejects(scan(guestlistWalletToken(entry, 'forged-secret')), { code: 'INVALID_CREDENTIAL' });
  assert.equal((await scan()).credential.spots, 3);
  assert.equal(entry.status, 'checked_in');
  await assert.rejects(scan(), { code: 'CREDENTIAL_ALREADY_USED' });
  entry.status = 'rejected'; entry.qrTokenHash = null;
  await assert.rejects(scan(), { code: 'INVALID_CREDENTIAL' });
});
test('wallet QR supports seeded tickets and is bound to holder, event and original credential', () => {
  const token = walletToken(ticket, secret);
  assert.equal(verifyWalletToken(token, ticket, secret), true);
  for (const field of ['id', 'holderUserId', 'eventId', 'qrTokenHash']) assert.equal(verifyWalletToken(token, { ...ticket, [field]: 'changed' }, secret), false);
  assert.equal(verifyWalletToken(token + 'x', ticket, secret), false);
  assert.equal(verifyWalletToken(token, ticket, 'different-secret'), false);
});
test('ticket retrieval scopes lookup to the customer and never exposes another holder', async () => {
  const service = createCustomerAccountService({ models: { Ticket: { findOne: async ({ where }) => { assert.deepEqual(where, { id: ticket.id, holderUserId: 'other' }); return null; } } } });
  await assert.rejects(service.ticket('other', ticket.id), { code: 'NOT_FOUND' });
});
test('unavailable tickets cannot generate wallet QR images', async () => {
  const event = { status: 'published', endsAt: new Date(Date.now() + 86400000) };
  for (const override of [{ status: 'void' }, { status: 'checked_in' }, { orderStatus: 'refunded' }, { eventStatus: 'cancelled' }, { endsAt: new Date(0) }]) {
    const row = { ...ticket, status: override.status || 'valid', orderItem: { order: { status: override.orderStatus || 'paid', event: { ...event, status: override.eventStatus || event.status, endsAt: override.endsAt || event.endsAt } } } };
    const service = createCustomerAccountService({ models: { Ticket: { findOne: async () => row } } });
    await assert.rejects(service.ticket(ticket.holderUserId, ticket.id), { code: 'TICKET_UNAVAILABLE' });
  }
});
function scanner({ status = 'paid', demo = false, environment = 'development', startsAt = '2026-09-22T00:00:00Z' } = {}) {
  const row = { ...ticket, update: async (patch) => Object.assign(row, patch) };
  const service = createCheckInService({ tokenSecret: secret, environment, now: () => new Date('2026-09-22T12:00:00Z'),
    sequelize: { transaction: async (_opts, callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) },
    models: { User: { findByPk: async () => ({ displayName: 'Guest' }) }, Ticket: { findOne: async ({ where }) => where.eventId === row.eventId ? row : null },
      GuestlistEntry: { findOne: async () => null }, Event: { findByPk: async () => ({ status: 'published', startsAt, endsAt: '2026-09-23T00:00:00Z' }) },
      OrderItem: { findByPk: async () => ({ orderId: 'order' }) }, Order: { findByPk: async () => ({ status, pricingPlanSnapshot: { demo } }) }, CheckIn: { create: async (value) => value } } });
  return (token = walletToken(ticket, secret), eventId = ticket.eventId) => service({ qrToken: token, eventId, checkedInByUserId: 'staff' });
}
test('wallet QR uses the admission scanner and cannot be replayed or scanned for a different event', async () => {
  const scan = scanner();
  await assert.rejects(scan(walletToken(ticket, secret), 'wrong-event'), { code: 'INVALID_CREDENTIAL' });
  await assert.rejects(scan(walletToken(ticket, 'forged-secret')), { code: 'INVALID_CREDENTIAL' });
  assert.equal((await scan()).credential.status, 'checked_in');
  await assert.rejects(scan(), { code: 'CREDENTIAL_ALREADY_USED' });
});
test('check-in blocks early admission, unpaid/refunded orders and production demo tickets', async () => {
  await assert.rejects(scanner({ startsAt: '2026-09-24T00:00:00Z' })(), { code: 'EVENT_NOT_OPEN' });
  await assert.rejects(scanner({ status: 'refunded' })(), { code: 'INVALID_CREDENTIAL' });
  await assert.rejects(scanner({ demo: true, environment: 'production' })(), { code: 'INVALID_CREDENTIAL' });
});
test('purchase ticket list includes individual entry states and hides other holders and unusable QR codes', async () => {
  const credentials = ['valid', 'checked_in', 'void', 'transferred'].map((status, index) => ({ ...ticket, id: `${ticket.id}-${index}`, status, checkedInAt: status === 'checked_in' ? new Date() : null }));
  credentials.push({ ...ticket, id: 'another-holder', holderUserId: 'different-customer' });
  const order = { id: 'purchase', status: 'paid', currency: 'USD', subtotalCents: 4000, totalCents: 4379, event: { status: 'published', endsAt: new Date(Date.now() + 86400000) }, items: [{ nameSnapshot: 'Group package', tickets: credentials }] };
  const service = createCustomerAccountService({ tokenSecret: secret, models: { Order: { findOne: async ({ where }) => where.buyerUserId === ticket.holderUserId ? order : null } } });
  const result = await service.purchaseTickets(ticket.holderUserId, 'purchase');
  assert.equal(result.tickets.length, 4);
  assert.match(result.tickets[0].qrImage, /^data:image\/png;base64,/);
  assert.equal(result.tickets[1].status, 'checked_in');
  assert.ok(result.tickets[1].checkedInAt);
  assert.equal(result.tickets[2].qrImage, null);
  assert.equal(result.tickets[3].qrImage, null);
  assert.ok(!JSON.stringify(result).includes('qrTokenHash'));
  await assert.rejects(service.purchaseTickets('different-customer', 'purchase'), { code: 'NOT_FOUND' });
});
