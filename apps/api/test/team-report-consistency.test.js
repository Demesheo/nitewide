const test = require('node:test');
const assert = require('node:assert/strict');
const { rosterPeople } = require('../src/services/team-service');
const { aggregateSales } = require('../src/services/business-service');
const { aggregateReferrals } = require('../src/services/analytics-service');

test('Team, Overview, and Analytics show the same people and credited figures', () => {
  const user = (id, displayName) => ({ id, displayName, email: `${id}@nitewide.test` });
  const leaders = [
    { userId: 'owner', organizationId: 'venue', role: 'owner', user: user('owner', 'Maya Owner') },
    { userId: 'manager', organizationId: 'venue', role: 'admin', user: user('manager', 'Sam Manager') },
  ];
  const employees = [{ userId: 'employee', organizationId: 'venue', status: 'active', user: user('employee', 'Tessa Employee') }];
  const promoter = { id: 'org-promoter', userId: 'promoter', organizationId: 'venue', status: 'active', code: 'PROMO', user: user('promoter', 'Leo Promoter') };
  const referrals = [
    { id: 'org-owner', userId: 'owner', organizationId: 'venue', user: leaders[0].user },
    { id: 'org-manager', userId: 'manager', organizationId: 'venue', user: leaders[1].user },
    promoter,
    { id: 'event-promoter', userId: 'promoter', organizationId: 'venue', eventId: 'event', user: promoter.user },
  ];
  const order = (id, buyerUserId, subtotalCents, affiliateCommissionCents, attribution = {}) => ({
    id, eventId: 'event', buyerUserId, buyer: user(buyerUserId, `Buyer ${buyerUserId}`), subtotalCents,
    affiliateCommissionCents, paidAt: '2026-09-21T12:00:00Z', items: [{ nameSnapshot: 'GA', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, lineTotalCents: subtotalCents }], ...attribution,
  });
  const orders = [
    order('owner-sale', 'buyer-1', 10000, 1000, { orgAffiliateId: 'org-owner' }),
    order('manager-sale', 'buyer-2', 20000, 2000, { orgAffiliateId: 'org-manager' }),
    order('promoter-sale', 'buyer-3', 30000, 3000, { orgAffiliateId: 'org-promoter', eventAffiliateId: 'event-promoter' }),
    order('direct-sale', 'buyer-4', 40000, 0),
  ];
  const team = rosterPeople(leaders, employees, [promoter, { ...referrals[0], status: 'active' }]);
  const overview = aggregateSales(orders, [{ id: 'event', title: 'Friday' }], referrals, leaders, employees);
  const analytics = aggregateReferrals(orders, referrals, leaders, employees);
  const ids = (rows) => [...rows.map((row) => row.id)].sort();
  assert.deepEqual(ids(team), ['employee', 'manager', 'owner', 'promoter']);
  assert.deepEqual(ids(overview.people), ids(team));
  assert.deepEqual(ids(analytics.people), ids(team));
  for (const person of team) {
    const overviewRow = overview.people.find((row) => row.id === person.id);
    const analyticsRow = analytics.people.find((row) => row.id === person.id);
    assert.equal(overviewRow.role, person.role);
    assert.equal(analyticsRow.role, person.role);
    assert.equal(overviewRow.name, person.name);
    assert.equal(analyticsRow.label, person.name);
    assert.equal(overviewRow.orders, analyticsRow.orders);
    assert.equal(overviewRow.salesCents, analyticsRow.salesCents);
    assert.equal(overviewRow.commissionCents, analyticsRow.commissionCents);
  }
  assert.equal(overview.people.find((row) => row.id === 'employee').salesCents, 0);
  assert.equal(overview.people.find((row) => row.id === 'owner').salesCents, 10000);
  assert.equal(overview.people.find((row) => row.id === 'manager').salesCents, 20000);
  assert.equal(overview.people.find((row) => row.id === 'promoter').salesCents, 30000);
  assert.equal(overview.summary.salesCents, 100000);
  assert.equal(overview.summary.directSalesCents, 40000);
  assert.equal(overview.summary.commissionCents, 6000);
  assert.equal(analytics.customers.length, 3);
});
