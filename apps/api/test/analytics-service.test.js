const test = require('node:test');
const assert = require('node:assert/strict');
const { reportDetailQuery } = require('../src/http/business-schemas');
const { reportDetailQuery: adminReportDetailQuery } = require('../src/http/admin-report-schemas');
const { reportDate } = require('../src/http/report-date-schemas');
const { calendarPeriod } = require('../src/services/business-report-period');
const { createBusinessReportService } = require('../src/services/business-report-service');
const { aggregateHierarchy, aggregateReferrals } = require('../src/services/analytics-service');

const event = (id, title, city, organization = null) => ({ id, title, category: 'nightlife', organizationId: organization?.id || null, creatorUserId: 'creator', creator: { displayName: 'Independent creator' }, organization, location: { city, region: 'FL', countryCode: 'US' }, startsAt: '2026-09-25T22:00:00Z' });
const order = (id, eventId, buyerUserId, subtotalCents, extra = {}) => ({ id, eventId, buyerUserId, subtotalCents, totalCents: subtotalCents + 179, platformFeeCents: 179, affiliateCommissionCents: 100, paidAt: '2026-09-21T12:00:00Z', items: [{ nameSnapshot: 'GA', kindSnapshot: 'ticket', quantity: 2, entriesPerUnitSnapshot: 1, lineTotalCents: subtotalCents }], buyer: { displayName: buyerUserId, email: `${buyerUserId}@example.test` }, ...extra });

test('report date filters require paired ordered dates and retain multiselect arrays', () => {
  const query = reportDetailQuery.parse({ startDate: '2026-09-01', endDate: '2026-09-21', regions: ['Orlando, FL, US', 'Miami, FL, US'] });
  assert.deepEqual(query.regions, ['Orlando, FL, US', 'Miami, FL, US']);
  assert.deepEqual(calendarPeriod(query, new Date('2026-09-21T12:00:00Z')), {
    startDate: '2026-09-01', endDate: '2026-09-21', timezone: 'UTC', currency: 'USD', basis: 'paidAt',
  });
  assert.equal(reportDetailQuery.safeParse({ startDate: '2026-09-21' }).success, false);
  assert.equal(reportDetailQuery.safeParse({ startDate: '2026-09-22', endDate: '2026-09-21' }).success, false);
  assert.equal(reportDetailQuery.safeParse({ startDate: 'invalid', endDate: '2026-03-01' }).success, false);
  for (const days of [0, 367]) assert.equal(reportDetailQuery.safeParse({ days }).success, false);
});

test('Business and Admin share actual calendar dates and a 366-day inclusive custom range', () => {
  const valid = [
    { startDate: '2024-01-01', endDate: '2024-12-31' }, // Full leap year: 366 days.
    { startDate: '2025-01-01', endDate: '2025-12-31' }, // Ordinary year: 365 days.
    { startDate: '2025-01-01', endDate: '2026-01-01' }, // Exactly 366 inclusive days.
    { startDate: '2024-02-29', endDate: '2024-02-29' },
    { startDate: '2000-02-29', endDate: '2000-02-29' },
    { startDate: '0099-01-01', endDate: '0099-01-01' },
    { startDate: '2026-03-08', endDate: '2026-03-08', timezone: 'America/New_York' },
    { startDate: '2026-11-01', endDate: '2026-11-01', timezone: 'America/New_York' },
  ];
  const invalid = [
    { startDate: '2026-02-31', endDate: '2026-03-03' },
    { startDate: '2026-04-30', endDate: '2026-04-31' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '1900-02-29', endDate: '1900-03-01' },
    { startDate: '2100-02-29', endDate: '2100-03-01' },
    { startDate: '0000-01-01', endDate: '0000-01-02' },
    { startDate: '2026-2-01', endDate: '2026-02-02' },
    { startDate: ' 2026-02-01', endDate: '2026-02-02' },
    { startDate: '2026-02-01T00:00:00Z', endDate: '2026-02-02' },
    { startDate: '', endDate: '' },
    { startDate: ['2026-02-01'], endDate: '2026-02-02' },
    { startDate: '2026-02-01' },
    { endDate: '2026-02-01' },
    { startDate: '2026-02-02', endDate: '2026-02-01' },
    { startDate: '2024-01-01', endDate: '2025-01-01' }, // 367, not a leap-year exception.
    { startDate: '2025-01-01', endDate: '2026-01-02', timezone: 'America/New_York' },
  ];
  for (const schema of [reportDetailQuery, adminReportDetailQuery]) {
    assert.equal(schema.shape.startDate.unwrap(), reportDate);
    assert.equal(schema.shape.endDate.unwrap(), reportDate);
    assert.equal(schema.parse({}).days, 30);
    assert.equal(schema.parse({}).timezone, 'UTC');
    for (const days of [7, 30, 90, 365, 366]) assert.equal(schema.parse({ days }).days, days);
    for (const input of valid) assert.equal(schema.safeParse(input).success, true, JSON.stringify(input));
    for (const input of invalid) assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));
    const span = schema.safeParse(invalid.at(-1));
    assert.deepEqual(span.error.issues.map(({ path, message }) => ({ path, message })), [{
      path: ['endDate'], message: 'Custom reports must span at most 366 calendar days, including the start and end dates.',
    }]);
    assert.deepEqual(schema.safeParse({ startDate: '2026-02-01' }).error.issues.map(issue => issue.path), [['endDate']]);
  }
});

test('a one-day report on 9999-12-31 terminates at the inclusive end without entering year 10000', async () => {
  const transaction = {};
  let calls = 0;
  const sequelize = { query: async (sql, options) => {
    assert.equal(options.transaction, transaction);
    calls += 1;
    if (calls === 1) {
      assert.match(sql, /AT TIME ZONE/);
      return [{ since: new Date('9999-12-31T00:00:00.000Z'), until: new Date('+010000-01-01T00:00:00.000Z') }];
    }
    assert.equal(calls, 2);
    assert.match(sql, /summary_daily/);
    return [{ financial: { salesCents: '1250', commissionCents: '0', directSalesCents: '1250', orders: 1, customers: 1 },
      units: { units: '1' }, tickets: { admissions: 1, checkedIn: 0 }, guests: { guestlistPlaces: 0, checkedIn: 0 },
      eventCount: { events: 1 }, activeEventCount: { events: 0 }, daily: [{ date: '9999-12-31', orders: 1, salesCents: '1250' }],
      channels: [], regionalMix: [], category: [], offerings: [], eventMix: [], event: null, person: null }];
  } };
  const reports = createBusinessReportService({ models: { Event: { sequelize } }, businessRead: {
    actor: async () => ({}), filters: async () => ({ sql: '', values: {} }),
  } });
  const query = reportDetailQuery.parse({ startDate: '9999-12-31', endDate: '9999-12-31', timezone: 'UTC' });
  const report = await reports.summary('fixture-user', query, { transaction });
  assert.deepEqual(report.daily, [{ date: '9999-12-31', orders: 1, salesCents: 1250 }]);
  assert.equal(report.summary.salesCents, 1250); assert.equal(report.range.endDate, '9999-12-31');
  assert.equal(calls, 2);
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
  assert.equal(report.summary.checkoutCents, 6537);
  assert.equal(report.summary.platformFeesCents, 537);
  assert.equal(report.summary.customers, 2);
  assert.equal(report.summary.units, 6);
  assert.equal(report.summary.admissions, 6);
  assert.equal(report.children.all.length, 2);
  assert.equal(report.children['event:e1'].length, 1);
  assert.equal(report.hierarchy.find((row) => row.id === 'customer:e1:buyer1').orders, 2);
  assert.equal(aggregateHierarchy(events, orders).hierarchy.some((row) => row.level === 'customer'), false);
  const business = aggregateHierarchy(events, orders, { includeCustomers: true });
  assert.equal(business.summary.salesCents, 6000);
  assert.equal('checkoutCents' in business.summary, false);
  assert.equal('platformFeesCents' in business.summary, false);
  assert.equal(business.hierarchy.some((row) => 'checkoutCents' in row || 'platformFeesCents' in row), false);
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
