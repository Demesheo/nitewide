const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { guestlistCustomerNames, fixtureEmail, planGuestlistFixtures, futureStatuses, pastStatuses } = require('../src/db/seed-guestlists');

test('local demo guestlists cover future statuses and past no-shows without purchases', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createPermissionService } = require('../src/services/permission-service');
  const { venues, slugify } = require('../src/db/seed');
  const config = getConfig();
  assert.notEqual(config.NODE_ENV, 'production');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname));
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  const permissions = createPermissionService(models);
  try {
    await sequelize.authenticate();
    const customers = await models.User.findAll({ where: { email: { [Op.in]: guestlistCustomerNames.map((_, index) => fixtureEmail(index)) } } });
    assert.equal(customers.length, guestlistCustomerNames.length);
    const customerIds = customers.map((customer) => customer.id);
    assert.equal(await models.Order.count({ where: { buyerUserId: { [Op.in]: customerIds } } }), 0);
    const organizations = await models.Organization.findAll({ where: { slug: { [Op.in]: venues.map((venue) => venue.legacySlug || slugify(venue.name)) } } });
    const events = await models.Event.findAll({ where: { organizationId: { [Op.in]: organizations.map((org) => org.id) }, status: 'published' } });
    const plan = planGuestlistFixtures(events);
    const entries = await models.GuestlistEntry.findAll({ where: { eventId: { [Op.in]: events.map((event) => event.id) }, userId: { [Op.in]: customerIds } } });
    const referredAffiliateIds = [...new Set(entries.map((entry) => entry.eventAffiliateId).filter(Boolean))];
    const affiliates = await models.EventAffiliate.findAll({ where: { id: { [Op.in]: referredAffiliateIds } } });
    const affiliateById = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate]));
    const leaders = await models.OrganizationOwner.findAll({ where: { organizationId: { [Op.in]: organizations.map((org) => org.id) } } });
    const employees = await models.OrganizationEmployee.findAll({ where: { organizationId: { [Op.in]: organizations.map((org) => org.id) }, status: 'active' } });
    const entriesByEventAndUser = new Map(entries.map((entry) => [`${entry.eventId}:${entry.userId}`, entry]));
    const customerIdByEmail = new Map(customers.map((customer) => [customer.email, customer.id]));
    for (const item of plan) {
      const userId = customerIdByEmail.get(fixtureEmail(item.userIndex));
      const entry = entriesByEventAndUser.get(`${item.event.id}:${userId}`);
      assert.ok(entry, `${item.event.title}: ${item.status} guest exists`);
      assert.equal(entry.status, item.status, `${item.event.title}: expected ${item.status}`);
      assert.equal(entry.source, item.referrerRole ? 'affiliate' : 'event');
      if (item.referrerRole) {
        assert.ok(entry.eventAffiliateId, `${item.event.title}: referrer exists`);
        const affiliate = affiliateById.get(entry.eventAffiliateId);
        assert.ok(affiliate, `${item.event.title}: linked referral exists`);
        if (item.referrerRole === 'promoter') assert.ok(affiliate.orgAffiliateId);
        if (item.referrerRole === 'employee') assert.ok(employees.some((person) => person.organizationId === item.event.organizationId && person.userId === affiliate.userId));
        if (item.referrerRole === 'owner' || item.referrerRole === 'manager') assert.ok(leaders.some((person) => person.organizationId === item.event.organizationId && person.userId === affiliate.userId && person.role === (item.referrerRole === 'owner' ? 'owner' : 'admin')));
        const scope = await permissions.guestlistReviewScope(affiliate.userId, item.event.id);
        assert.equal(scope.event.id, item.event.id, `${item.referrerRole} can review the referred request`);
        if (item.referrerRole === 'owner' || item.referrerRole === 'manager') assert.equal(scope.canReviewAny, true);
        else { assert.equal(scope.canReviewAny, false); assert.ok(scope.eventAffiliateIds.includes(entry.eventAffiliateId)); }
      }
      if (futureStatuses.includes(item.status)) assert.equal(entry.checkedInAt, null);
    }
    const futureIds = new Set(plan.filter((item) => futureStatuses.includes(item.status)).map((item) => item.event.id));
    for (const eventId of futureIds) {
      const statuses = entries.filter((entry) => entry.eventId === eventId).map((entry) => entry.status);
      for (const status of futureStatuses) assert.ok(statuses.includes(status), `${eventId}: ${status}`);
      assert.ok(!statuses.includes('checked_in'), `${eventId}: no future check-in`);
      assert.ok(!statuses.includes('no_show'), `${eventId}: no future no-show`);
    }
    assert.ok(plan.some((item) => pastStatuses.includes(item.status)));
  } finally { await sequelize.close(); }
});
