const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateSales } = require('../src/services/business-service');
const { aggregateReferrals } = require('../src/services/analytics-service');
const { summarizeEvent } = require('../src/services/event-workspace-service');

const roles = [
  { userId: 'owner', name: 'Owner One', role: 'Owner', affiliateId: 'a-owner', rate: 0, partySize: 1, status: 'pending' },
  { userId: 'manager', name: 'Manager Five', role: 'Manager', affiliateId: 'a-manager', rate: 500, partySize: 2, status: 'confirmed' },
  { userId: 'employee', name: 'Employee Twelve', role: 'Employee', affiliateId: 'a-employee', rate: 1250, partySize: 3, status: 'checked_in' },
  { userId: 'org-promoter', name: 'Organization Promoter', role: 'Promoter', affiliateId: 'a-org-promoter', rate: 2000, partySize: 4, status: 'rejected' },
  { userId: 'event-promoter', name: 'Event Promoter', role: 'Promoter', affiliateId: 'a-event-promoter', rate: 4000, partySize: 5, status: 'confirmed' },
  { userId: 'creator', name: 'Independent Creator', role: 'Creator', affiliateId: 'a-creator', rate: 750, partySize: 2, status: 'confirmed' },
];

const affiliates = roles.map((role) => ({ id: role.affiliateId, userId: role.userId, organizationId: role.role === 'Creator' ? null : 'org', role: role.role === 'Creator' ? 'Creator' : undefined, user: { displayName: role.name } }));
const orders = roles.map((role, index) => ({
  id: `order-${index}`, eventId: 'event', buyerUserId: `buyer-${index}`,
  subtotalCents: 10000, totalCents: 10829, platformFeeCents: 829,
  affiliateCommissionCents: role.rate, eventAffiliateId: role.affiliateId,
  paidAt: `2026-09-2${index + 1}T12:00:00Z`, buyer: { displayName: `Buyer ${index}` },
  items: [{ offeringId: 'ga', nameSnapshot: 'GA', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, lineTotalCents: 10000, tickets: [{ holderUserId: `buyer-${index}`, status: 'valid' }] }],
}));
const guests = roles.map((role, index) => ({ eventId: 'event', userId: `guest-${index}`, eventAffiliateId: role.affiliateId, partySize: role.partySize, status: role.status, user: { displayName: `Guest ${index}` } }));
const leaders = [
  { userId: 'owner', organizationId: 'org', role: 'owner', user: { displayName: 'Owner One' } },
  { userId: 'manager', organizationId: 'org', role: 'admin', user: { displayName: 'Manager Five' } },
];
const employees = [{ userId: 'employee', organizationId: 'org', user: { displayName: 'Employee Twelve' } }];

function assertRoleMatrix(rows, labelKey) {
  for (const expected of roles) {
    const row = rows.find((person) => person.id === expected.userId || person.userId === expected.userId);
    assert.ok(row, `${expected.role} is present`);
    assert.equal(row[labelKey], expected.name);
    assert.equal(row.role, expected.role);
    assert.equal(row.orders, 1);
    assert.equal(row.salesCents, 10000);
    assert.equal(row.commissionCents, expected.rate);
    assert.equal(row.guestlistRequests, 1);
    assert.equal(row.guestlistPlaces, expected.partySize);
    assert.equal(row.approvedGuestlistPlaces, ['confirmed', 'checked_in'].includes(expected.status) ? expected.partySize : 0);
  }
}

test('event, overview, and analytics reports agree across roles, commission rates, purchases, and guestlists', () => {
  const eventPeople = roles.map((role) => ({ id: role.affiliateId, userId: role.userId, name: role.name, role: role.role, commissionBps: role.rate }));
  const eventReport = summarizeEvent({ orders, offerings: [{ id: 'ga', name: 'GA', kind: 'ticket' }], people: eventPeople, guests });
  const overview = aggregateSales(orders, [{ id: 'event', title: 'Matrix event' }], affiliates, leaders, employees, guests);
  const analytics = aggregateReferrals(orders, affiliates, leaders, employees, guests);

  assertRoleMatrix(eventReport.people, 'name');
  assertRoleMatrix(overview.people, 'name');
  assertRoleMatrix(analytics.people, 'label');
  assert.equal(eventReport.summary.salesCents, 60000);
  assert.equal(eventReport.summary.commissionCents, 8500);
  assert.equal(overview.summary.salesCents, 60000);
  assert.equal(overview.summary.commissionCents, 8500);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.salesCents, 0), 60000);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.commissionCents, 0), 8500);
});

test('guestlist activity never creates sales or commission and preserves approval state', () => {
  const analytics = aggregateReferrals([], affiliates, leaders, employees, guests);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.salesCents, 0), 0);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.commissionCents, 0), 0);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.guestlistPlaces, 0), 17);
  assert.equal(analytics.people.reduce((sum, row) => sum + row.approvedGuestlistPlaces, 0), 12);
  assert.equal(analytics.customers.length, roles.length);
});

test('historical commission snapshots remain unchanged when current configured rates change', () => {
  const changedAffiliates = affiliates.map((affiliate) => ({ ...affiliate, commissionBps: 0 }));
  const analytics = aggregateReferrals(orders, changedAffiliates, leaders, employees, guests);
  for (const expected of roles) assert.equal(analytics.people.find((row) => row.id === expected.userId).commissionCents, expected.rate);
});
