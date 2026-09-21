const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsQuery } = require('../src/http/analytics-schemas');
const { aggregateHierarchy, aggregateReferrals, createAnalyticsService, resolveRange } = require('../src/services/analytics-service');

const event = (id, title, city, organization = null) => ({ id, title, category: 'nightlife', organizationId: organization?.id || null, creatorUserId: 'creator', creator: { displayName: 'Independent creator' }, organization, location: { city, region: 'FL', countryCode: 'US' }, startsAt: '2026-09-25T22:00:00Z' });
const order = (id, eventId, buyerUserId, subtotalCents, extra = {}) => ({ id, eventId, buyerUserId, subtotalCents, totalCents: subtotalCents + 179, platformFeeCents: 179, affiliateCommissionCents: 100, paidAt: '2026-09-21T12:00:00Z', items: [{ nameSnapshot: 'GA', kindSnapshot: 'ticket', quantity: 2, entriesPerUnitSnapshot: 1, lineTotalCents: subtotalCents }], buyer: { displayName: buyerUserId, email: `${buyerUserId}@example.test` }, ...extra });

test('date filters require valid inclusive bounded ranges and multiselect arrays', () => {
  const query = analyticsQuery.parse({ startDate: '2026-09-01', endDate: '2026-09-21', regions: ['Orlando, FL, US', 'Miami, FL, US'], organizationIds: ['independent'] });
  assert.deepEqual(query.regions, ['Orlando, FL, US', 'Miami, FL, US']);
  assert.equal(resolveRange(query).until.toISOString(), '2026-09-22T00:00:00.000Z');
  assert.equal(analyticsQuery.safeParse({ startDate: '2026-09-21' }).success, false);
  assert.equal(analyticsQuery.safeParse({ startDate: '2026-09-22', endDate: '2026-09-21' }).success, false);
  assert.equal(analyticsQuery.safeParse({ startDate: '2026-02-30', endDate: '2026-03-01' }).success, false);
});

test('managers are labeled separately before their first attributed sale', () => {
  const refs = aggregateReferrals([], [], [{ userId: 'manager', role: 'admin', user: { displayName: 'Sam Rivera' } }]);
  assert.deepEqual(refs.people.map(({ id, role, orders, customers }) => ({ id, role, orders, customers })), [{ id: 'manager', role: 'Manager', orders: 0, customers: 0 }]);
});
test('owners, managers, and employees each retain a personal row with zero credited sales', () => {
  const refs = aggregateReferrals([], [], [
    { userId: 'owner', role: 'owner', user: { displayName: 'Maya' } },
    { userId: 'manager', role: 'admin', user: { displayName: 'Sam' } },
  ], [{ userId: 'employee', user: { displayName: 'Tessa' } }]);
  assert.deepEqual(refs.people.map(({ label, role, salesCents }) => ({ label, role, salesCents })), [
    { label: 'Maya', role: 'Owner', salesCents: 0 },
    { label: 'Sam', role: 'Manager', salesCents: 0 },
    { label: 'Tessa', role: 'Employee', salesCents: 0 },
  ]);
});

test('hierarchy rolls orders, revenue, customers, units and admissions up once', () => {
  const events = [event('e1', 'Friday', 'Orlando', { id: 'org', name: 'OHM' }), event('e2', 'Saturday', 'Miami')];
  const orders = [order('o1', 'e1', 'buyer1', 2000), order('o2', 'e1', 'buyer1', 3000), order('o3', 'e2', 'buyer2', 1000)];
  const report = aggregateHierarchy(events, orders, { admin: true });
  assert.equal(report.summary.events, 2);
  assert.equal(report.summary.orders, 3);
  assert.equal(report.summary.salesCents, 6000);
  assert.equal(report.summary.customers, 2);
  assert.equal(report.summary.units, 6);
  assert.equal(report.summary.admissions, 6);
  assert.equal(report.children.all.length, 2);
  assert.equal(report.children['event:e1'].length, 1);
  assert.equal(report.hierarchy.find((row) => row.id === 'customer:e1:buyer1').orders, 2);
  assert.equal(aggregateHierarchy(events, orders).hierarchy.some((row) => row.level === 'customer'), false);
  const business = aggregateHierarchy(events, orders, { includeCustomers: true });
  assert.equal(business.children['event:e1'].length, 1);
  assert.equal(business.hierarchy.find((row) => row.id === 'customer:e1:buyer1').admissions, 4);
});

test('referral drill respects event-affiliate precedence and groups referred customers', () => {
  const orders = [order('o1', 'e1', 'buyer1', 2000, { orgAffiliateId: 'org-ref', eventAffiliateId: 'event-ref' }), order('o2', 'e1', 'buyer1', 3000, { eventAffiliateId: 'event-ref' })];
  const refs = aggregateReferrals(orders, [{ id: 'org-ref', userId: 'staff', user: { displayName: 'Sam' } }, { id: 'event-ref', userId: 'promoter', user: { displayName: 'Leo' } }], [{ userId: 'staff' }]);
  assert.equal(refs.people.length, 2);
  assert.equal(refs.people.find((person) => person.id === 'promoter').label, 'Leo');
  assert.equal(refs.people.find((person) => person.id === 'promoter').customers, 1);
  assert.equal(refs.people.find((person) => person.id === 'staff').salesCents, 0);
  assert.equal(refs.customers[0].salesCents, 5000);
});

test('admin analytics rejects non-admin identity before reading report data', async () => {
  let accessed = false;
  const service = createAnalyticsService({ models: { Event: { findAll: async () => { accessed = true; } } }, permissions: { assertInternal: async () => { throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); } } });
  await assert.rejects(() => service.adminReport('customer', analyticsQuery.parse({})), { code: 'FORBIDDEN' });
  assert.equal(accessed, false);
});
