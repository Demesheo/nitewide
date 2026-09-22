const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { createCustomerAccountService } = require('../src/services/customer-account-service');

// Evaluate the same scoped predicates used by the service; dates are independent
// of eligibility, so past/future relationships remain after an event ends.
function matches(row, where) {
  return Reflect.ownKeys(where).every((key) => {
    const value = where[key];
    if (key === Op.or) return value.some((clause) => matches(row, clause));
    if (Array.isArray(value)) return value.includes(row[key]);
    if (value && typeof value === 'object') {
      if (Op.ne in value) return value[Op.ne] === null ? row[key] != null : row[key] !== value[Op.ne];
      if (Op.gt in value) return new Date(row[key]) > value[Op.gt];
    }
    return row[key] === value;
  });
}
function fixture(extra = {}, links = { ownLink: async (userId, eventId) => ({ code: `${userId}-${eventId}` }) }) {
  const rows = { Order: [], GuestlistEntry: [], GuestlistInvitation: [], EventAffiliate: [], OrgAffiliate: [], OrganizationOwner: [], OrganizationEmployee: [], Event: [],
    User: [{ id: 'person', displayName: 'Alex', isActive: true }, { id: 'customer', displayName: 'Customer', isActive: true }], ...extra };
  const calls = [];
  const models = Object.fromEntries(Object.entries(rows).map(([name, data]) => [name, { findAll: async (options) => { calls.push({ name, ...options }); return data.filter((row) => matches(row, options.where)); } }]));
  return { calls, service: createCustomerAccountService({ models, now: () => new Date('2026-09-22T12:00:00Z'), referralLinks: links }) };
}
const ref = { id: 'ref', userId: 'person', eventId: 'past', status: 'active' };
test('direct-only purchases and guestlists, pending/unclaimed invites, and other users never unlock Connections', async () => {
  const { service } = fixture({ Order: [{ buyerUserId: 'customer', status: 'paid' }, { buyerUserId: 'other', status: 'paid', eventAffiliateId: 'ref' }],
    GuestlistEntry: [{ userId: 'customer', status: 'confirmed', eventAffiliateId: null }, { userId: 'other', eventAffiliateId: 'ref' }],
    GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'pending', invitedByUserId: 'person' }, { acceptedByUserId: 'other', status: 'accepted', invitedByUserId: 'person' }], EventAffiliate: [ref] });
  assert.deepEqual(await service.connectionHistory('customer'), { eligible: false, people: [] });
});
test('referred paid bookings unlock regardless of event date; event referral takes precedence over org referral', async () => {
  const { service, calls } = fixture({ Order: ['past', 'current', 'future'].map((eventId, index) => ({ id: `order-${index}`, eventId, buyerUserId: 'customer', status: 'paid', eventAffiliateId: 'ref', orgAffiliateId: 'other-ref', paidAt: `2026-09-${20 + index}T12:00:00Z` })),
    EventAffiliate: [ref], OrgAffiliate: [{ id: 'other-ref', userId: 'other' }] });
  const result = await service.connectionHistory('customer');
  assert.equal(result.eligible, true); assert.equal(result.people.length, 1);
  assert.equal(result.people[0].bookings, 3); assert.equal(result.people[0].connectedEvents, 3);
  assert.equal(result.people[0].lastConnectedAt, '2026-09-22T12:00:00.000Z');
  assert.equal(calls.find((call) => call.name === 'Order').where.buyerUserId, 'customer');
  assert.ok(!JSON.stringify(result).includes('email'));
});
test('organization referrals, referred guestlists, and accepted direct-pool invites independently unlock', async () => {
  for (const data of [
    { Order: [{ buyerUserId: 'customer', eventId: 'night', status: 'paid', orgAffiliateId: 'org-ref' }], OrgAffiliate: [{ id: 'org-ref', userId: 'person' }] },
    { GuestlistEntry: [{ userId: 'customer', eventId: 'night', status: 'confirmed', eventAffiliateId: 'ref' }], EventAffiliate: [ref] },
    { GuestlistInvitation: [{ acceptedByUserId: 'customer', eventId: 'night', status: 'accepted', invitedByUserId: 'person' }] },
  ]) {
    const { service } = fixture(data); const summary = await service.connectionHistory('customer');
    assert.equal(summary.eligible, true); assert.equal(summary.people[0].id, 'person');
    assert.deepEqual(await service.connections('customer'), []); // Still eligible between events.
  }
});
test('guestlist invitation and resulting referral entry count once per person/event', async () => {
  const { service } = fixture({ GuestlistEntry: [{ userId: 'customer', eventId: 'night', eventAffiliateId: 'ref', status: 'checked_in' }], EventAffiliate: [ref],
    GuestlistInvitation: [{ acceptedByUserId: 'customer', eventId: 'night', status: 'accepted', invitedByUserId: 'person' }] });
  const summary = await service.connectionHistory('customer');
  assert.equal(summary.people[0].guestlistEvents, 1); assert.equal(summary.people[0].connectedEvents, 1);
});
test('unpaid/refunded purchases and self-referrals do not create connections; inactive people stay private', async () => {
  const { service } = fixture({ Order: [{ buyerUserId: 'customer', status: 'refunded', eventAffiliateId: 'ref' }, { buyerUserId: 'customer', status: 'pending', eventAffiliateId: 'ref' }], EventAffiliate: [ref] });
  assert.equal((await service.connectionHistory('customer')).eligible, false);
  const self = fixture({ GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'customer' }] });
  assert.equal((await self.service.connectionHistory('customer')).eligible, false);
  const inactive = fixture({ User: [{ id: 'person', isActive: false }], GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'person' }] });
  assert.deepEqual(await inactive.service.connectionHistory('customer'), { eligible: true, people: [] });
});
test('future events cross venues and event-only assignments, excluding removed, private and past events', async () => {
  const event = (id, organizationId, extra = {}) => ({ id, organizationId, title: id, status: 'published', isDiscoverable: true, startsAt: '2026-09-25T22:00:00Z', endsAt: '2026-09-26T03:00:00Z', ...extra });
  const { service } = fixture({ GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'person' }],
    OrganizationEmployee: [{ userId: 'person', organizationId: 'venue-one', status: 'active' }, { userId: 'person', organizationId: 'venue-two', status: 'active' }],
    EventAffiliate: [{ userId: 'person', eventId: 'event-only', status: 'active' }],
    Event: [event('one', 'venue-one'), event('two', 'venue-two'), event('removed', 'venue-one'), event('event-only', 'other'), event('private', 'venue-one', { isDiscoverable: false }), event('past', 'venue-one', { startsAt: '2026-09-01' }), event('unrelated', 'other')],
  }, { ownLink: async (_user, eventId) => { if (eventId === 'removed') throw Object.assign(new Error('Removed'), { status: 403 }); return { code: `VALID-${eventId}` }; } });
  const result = await service.connections('customer');
  assert.deepEqual(result.map((entry) => entry.event.id), ['one', 'two', 'event-only']);
  assert.ok(result.every((entry) => entry.referrer.name === 'Alex' && entry.code.startsWith('VALID-')));
  assert.deepEqual((await service.connections('customer', { eventId: 'two' })).map((entry) => entry.event.id), ['two']);
  for (const eventId of ['private', 'past', 'removed', 'unrelated', 'missing']) {
    assert.deepEqual(await service.connections('customer', { eventId }), [], `No referral options for ${eventId}`);
  }
});
test('event-scoped connections constrain the database query before the feed limit', async () => {
  const { service, calls } = fixture({ GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'person' }] });
  await service.connections('customer', { eventId: 'far-future' });
  const query = calls.find((call) => call.name === 'Event');
  assert.equal(query.where.id, 'far-future');
  assert.equal(query.where.isDiscoverable, true);
  assert.equal(query.where.status, 'published');
});
test('independent creator connections do not grant access to another creator’s events', async () => {
  const makeEvent = (id, creatorUserId) => ({ id, organizationId: null, creatorUserId, title: id, status: 'published', isDiscoverable: true, startsAt: '2026-09-25T22:00:00Z' });
  const { service } = fixture({ GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'person' }], Event: [makeEvent('own', 'person'), makeEvent('other', 'someone-else')] });
  assert.deepEqual((await service.connections('customer')).map((row) => row.event.id), ['own']);
  assert.deepEqual(await service.connections('customer', { eventId: 'other' }), []);
  assert.deepEqual(await service.connections('another-customer', { eventId: 'own' }), []);
});
test('unexpected referral-service failures are surfaced rather than silently presented as no connections', async () => {
  const failure = new Error('Database unavailable');
  const { service } = fixture({ GuestlistInvitation: [{ acceptedByUserId: 'customer', status: 'accepted', invitedByUserId: 'person' }],
    Event: [{ id: 'own', organizationId: null, creatorUserId: 'person', status: 'published', isDiscoverable: true, startsAt: '2026-09-25T22:00:00Z' }],
  }, { ownLink: async () => { throw failure; } });
  await assert.rejects(service.connections('customer'), (error) => error === failure);
});
