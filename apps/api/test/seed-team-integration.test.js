// Opt-in, read-only contract check against the local seeded development database.
const test = require('node:test');
const assert = require('node:assert/strict');

test('seeded Team, Overview, and Analytics agree for every demo venue', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { venues, teamCountsForVenue, slugify } = require('../src/db/seed');
  const { createPermissionService } = require('../src/services/permission-service');
  const { createBusinessService } = require('../src/services/business-service');
  const { createAnalyticsService } = require('../src/services/analytics-service');
  const { createTeamService } = require('../src/services/team-service');
  const { reportQuery } = require('../src/http/business-schemas');
  const { analyticsQuery } = require('../src/http/analytics-schemas');
  const config = getConfig();
  assert.notEqual(config.NODE_ENV, 'production');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname), 'Seed check requires a local database');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  try {
    await sequelize.authenticate();
    const owner = await models.User.findOne({ where: { email: 'maya.owner@nitewide.test' } });
    assert.ok(owner, 'The demo seed must be present');
    const permissions = createPermissionService(models);
    const teamService = createTeamService({ models, permissions });
    const businessService = createBusinessService({ models, permissions });
    const analyticsService = createAnalyticsService({ models, permissions });
    for (const [venueIndex, venue] of venues.entries()) {
      const slug = venue.legacySlug || slugify(venue.name);
      const organization = await models.Organization.findOne({ where: { slug: slug === 'room-22' ? 'proper' : slug } });
      assert.ok(organization, `${venue.name} must be seeded`);
      const team = await teamService.roster(owner.id, organization.id);
      const overview = await businessService.workspace(owner.id, reportQuery.parse({ days: 30, organizationId: organization.id }));
      const analytics = await analyticsService.businessReport(owner.id, analyticsQuery.parse({ days: 30, organizationIds: [organization.id] }));
      const counts = ['room-22','proper'].includes(slug)
        ? { managers:teamCountsForVenue(1).managers + teamCountsForVenue(3).managers, employees:teamCountsForVenue(1).employees + teamCountsForVenue(3).employees }
        : teamCountsForVenue(venueIndex);
      assert.equal(team.people.filter((person) => person.role === 'Owner').length, 1, venue.name);
      assert.equal(team.people.filter((person) => person.role === 'Manager').length, counts.managers, venue.name);
      assert.equal(team.people.filter((person) => person.role === 'Employee').length, counts.employees, venue.name);
      assert.equal(team.people.filter((person) => person.role === 'Promoter').length, ['room-22','proper'].includes(slug) ? 4 : 2, venue.name);
      const overviewById = new Map(overview.report.people.map((person) => [person.id, person]));
      const analyticsById = new Map(analytics.referrals.people.map((person) => [person.id, person]));
      const teamIds = [...team.people.map((person) => person.id)].sort();
      assert.deepEqual([...overviewById.keys()].sort(), teamIds, `${venue.name} Overview people`);
      assert.deepEqual([...analyticsById.keys()].sort(), teamIds, `${venue.name} Analytics people`);
      for (const person of team.people) {
        const overviewPerson = overviewById.get(person.id);
        const analyticsPerson = analyticsById.get(person.id);
        assert.equal(overviewPerson.role, person.role, `${venue.name} ${person.name} Overview role`);
        assert.equal(analyticsPerson.role, person.role, `${venue.name} ${person.name} Analytics role`);
        assert.equal(overviewPerson.name, person.name, `${venue.name} ${person.name} Overview name`);
        assert.equal(analyticsPerson.label, person.name, `${venue.name} ${person.name} Analytics name`);
        for (const key of ['orders', 'salesCents', 'commissionCents']) assert.equal(overviewPerson[key], analyticsPerson[key], `${venue.name} ${person.name} ${key}`);
      }
      assert.equal(overview.report.summary.salesCents, analytics.summary.salesCents, `${venue.name} venue sales`);
      assert.equal(overview.report.summary.orders, analytics.summary.orders, `${venue.name} venue orders`);
      assert.equal(overview.report.summary.directSalesCents + overview.report.people.reduce((sum, person) => sum + person.salesCents, 0), overview.report.summary.salesCents, `${venue.name} attribution balance`);
    }
  } finally { await sequelize.close(); }
});
