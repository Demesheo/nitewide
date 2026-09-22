// Read-only: verifies the combined Proper/Room 22 seed without changing records.
const test = require('node:test');
const assert = require('node:assert/strict');
test('authorized Proper staff can select either venue or both; unrelated managers cannot', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const config = getConfig();
  assert.notEqual(config.NODE_ENV, 'production');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname));
  const db = require('../src/db/sequelize').createSequelize(config);
  const models = require('../src/db/models').initModels(db);
  const permissions = require('../src/services/permission-service').createPermissionService(models);
  const business = require('../src/services/business-service').createBusinessService({ models, permissions });
  const analytics = require('../src/services/analytics-service').createAnalyticsService({ models, permissions });
  const { reportQuery } = require('../src/http/business-schemas');
  const { analyticsQuery } = require('../src/http/analytics-schemas');
  try {
    const org = await models.Organization.findOne({ where: { slug: 'proper' } });
    assert.ok(org, 'Run the Orlando seed refresh first');
    let keys;
    for (const email of ['maya.owner@nitewide.test', 'elena.torres.manager@nitewide.test', 'nia.bennett.manager@nitewide.test']) {
      const user = await models.User.findOne({ where: { email } });
      assert.ok(user, email);
      const query = { days: 30, organizationIds: [org.id] };
      const all = await business.workspace(user.id, reportQuery.parse(query));
      assert.deepEqual(all.venues.map(v => v.label).sort(), ['Proper', 'Room 22']);
      keys = all.venues.map(v => v.id);
      let sales = 0, orders = 0, eventCount = 0;
      for (const venue of all.venues) {
        const selected = { ...query, venueIds: [venue.id] };
        const workspace = await business.workspace(user.id, reportQuery.parse(selected));
        const report = await analytics.businessReport(user.id, analyticsQuery.parse(selected));
        assert.ok(workspace.events.length > 0);
        assert.ok(workspace.events.every(e => e.location.name === venue.label));
        assert.equal(workspace.venues.length, 2, 'Selecting a venue must not hide the other option');
        assert.equal(workspace.report.summary.salesCents, report.summary.salesCents);
        assert.equal(workspace.report.summary.orders, report.summary.orders);
        assert.equal(report.options.venues.length, 2);
        assert.ok(report.hierarchy.filter(r => r.kind === 'venue').every(r => r.label === venue.label));
        sales += workspace.report.summary.salesCents;
        orders += workspace.report.summary.orders;
        eventCount += workspace.events.length;
      }
      const both = await business.workspace(user.id, reportQuery.parse({ ...query, venueIds: keys }));
      assert.equal(both.events.length, eventCount);
      assert.equal(both.report.summary.salesCents, sales);
      assert.equal(both.report.summary.orders, orders);
      assert.equal(both.report.summary.salesCents, all.report.summary.salesCents);
    }
    const outsider = await models.User.findOne({ where: { email: 'sam.rivera.manager@nitewide.test' } });
    assert.ok(outsider);
    const query = { days: 30, organizationIds: [org.id], venueIds: keys };
    const denied = await business.workspace(outsider.id, reportQuery.parse(query));
    assert.equal(denied.events.length, 0);
    assert.equal(denied.venues.length, 0);
    assert.equal(denied.report.summary.salesCents, 0);
    const report = await analytics.businessReport(outsider.id, analyticsQuery.parse(query));
    assert.equal(report.summary.salesCents, 0);
    assert.equal(report.options.venues.length, 0);
  } finally { await db.close(); }
});
