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
  const business = require('../src/services/business-read-service').createBusinessReadService({ models });
  const analytics = require('../src/services/business-report-service').createBusinessReportService({ models, businessRead: business });
  const { reportDetailQuery: reportQuery, eventPageQuery } = require('../src/http/business-schemas');

  try {
    const org = await models.Organization.findOne({ where: { slug: 'proper' } });
    assert.ok(org, 'Run the Orlando seed refresh first');
    let keys;
    for (const email of ['maya.owner@nitewide.test', 'elena.torres.manager@nitewide.test', 'nia.bennett.manager@nitewide.test']) {
      const user = await models.User.findOne({ where: { email } });
      assert.ok(user, email);
      const query = { days: 30, organizationIds: [org.id] };
      const all = await business.bootstrap(user.id);
      assert.deepEqual(all.venues.map(v => v.label).sort(), ['Proper', 'Room 22']);
      keys = all.venues.map(v => v.id);
      let sales = 0, orders = 0, eventCount = 0;
      for (const venue of all.venues) {
        const selected = { ...query, venueIds: [venue.id] };
        const workspace = await business.events(user.id, eventPageQuery.parse({ ...selected, pageSize: 100 }));
        const report = await analytics.summary(user.id, reportQuery.parse(selected));
        assert.ok(workspace.items.length > 0);
        assert.ok(workspace.items.every(e => venue.locationIds.includes(e.locationId)));
        assert.equal((await business.bootstrap(user.id)).venues.length, 2, 'Selecting a venue must not hide the other option');
        const overview = await business.overview(user.id, reportQuery.parse(selected));
        assert.equal(overview.summary.salesCents, report.summary.salesCents);
        assert.equal(overview.summary.orders, report.summary.orders);
        assert.equal(all.venues.length, 2);
        const venueRows = await analytics.table(user.id, 'venues', reportQuery.parse(selected));
        assert.ok(venueRows.items.every(r => r.label === venue.label));
        sales += report.summary.salesCents;
        orders += report.summary.orders;
        eventCount += workspace.total;
      }
      const both = await analytics.summary(user.id, reportQuery.parse({ ...query, venueIds: keys }));
      assert.equal(both.summary.events, eventCount);
      assert.equal(both.summary.salesCents, sales);
      assert.equal(both.summary.orders, orders);
      assert.equal(both.summary.salesCents, (await analytics.summary(user.id, reportQuery.parse(query))).summary.salesCents);
    }
    const outsider = await models.User.findOne({ where: { email: 'sam.rivera.manager@nitewide.test' } });
    assert.ok(outsider);
    const query = { days: 30, organizationIds: [org.id], venueIds: keys };
    const denied = await business.bootstrap(outsider.id);
    const deniedEvents = await business.events(outsider.id, eventPageQuery.parse(query));
    assert.equal(deniedEvents.items.length, 0);
    assert.equal(denied.venues.length, 0);

    const report = await analytics.summary(outsider.id, reportQuery.parse(query));
    assert.equal(report.summary.salesCents, 0);
    assert.equal(denied.venues.length, 0);
  } finally { await db.close(); }
});
