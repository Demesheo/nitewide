const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('Team, Overview, and Analytics agree across isolated owner, manager, employee, and promoter fixtures', async () => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createPermissionService } = require('../src/services/permission-service');
  const { createBusinessReadService } = require('../src/services/business-read-service');
  const { createBusinessReportService } = require('../src/services/business-report-service');
  const { createTeamService } = require('../src/services/team-service');
  const { reportQuery, reportDetailQuery, eventPageQuery } = require('../src/http/business-schemas');
  const { Op } = require('sequelize');

  const config = getConfig();
  assert.equal(config.NODE_ENV, 'test');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  const ids = {
    owner: randomUUID(), buyerA: randomUUID(), buyerB: randomUUID(),
    organizations: [randomUUID(), randomUUID()], locations: [randomUUID(), randomUUID()],
    managers: [randomUUID(), randomUUID()], employees: [randomUUID(), randomUUID()],
    promoters: [randomUUID(), randomUUID()], events: [randomUUID(), randomUUID()],
    affiliates: [randomUUID(), randomUUID()], offerings: [randomUUID(), randomUUID()],
    orders: [randomUUID(), randomUUID()], items: [randomUUID(), randomUUID()],
    tickets: [randomUUID(), randomUUID()], guests: [randomUUID(), randomUUID()],
  };
  const users = [ids.owner, ids.buyerA, ids.buyerB, ...ids.managers, ...ids.employees, ...ids.promoters];
  const now = new Date();
  const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 5 * 60 * 60 * 1000);
  let server;

  try {
    await sequelize.authenticate();
    await models.User.bulkCreate([
      { id: ids.owner, displayName: 'Fixture Portfolio Owner', email: `${ids.owner}@reporting.nitewide.test` },
      { id: ids.buyerA, displayName: 'Fixture Buyer One', email: `${ids.buyerA}@reporting.nitewide.test` },
      { id: ids.buyerB, displayName: 'Fixture Buyer Two', email: `${ids.buyerB}@reporting.nitewide.test` },
      ...ids.managers.map((id, i) => ({ id, displayName: `Fixture Manager ${i + 1}`, email: `${id}@reporting.nitewide.test` })),
      ...ids.employees.map((id, i) => ({ id, displayName: `Fixture Employee ${i + 1}`, email: `${id}@reporting.nitewide.test` })),
      ...ids.promoters.map((id, i) => ({ id, displayName: `Fixture Promoter ${i + 1}`, email: `${id}@reporting.nitewide.test` })),
    ]);

    for (let index = 0; index < 2; index += 1) {
      const organizationId = ids.organizations[index];
      const locationId = ids.locations[index];
      const managerId = ids.managers[index];
      const employeeId = ids.employees[index];
      const promoterId = ids.promoters[index];
      const eventId = ids.events[index];
      const buyerId = index === 0 ? ids.buyerA : ids.buyerB;
      const affiliateId = ids.affiliates[index];
      const orderId = ids.orders[index];

      await models.Location.create({
        id: locationId, name: `Reporting Fixture Venue ${index + 1}`, addressLine1: `${100 + index} Test Street`,
        city: index === 0 ? 'Orlando' : 'Tampa', region: 'FL', postalCode: index === 0 ? '32801' : '33602',
        countryCode: 'US', timezone: 'America/New_York', privacy: 'private',
      });
      await models.Organization.create({
        id: organizationId, name: `Reporting Fixture Org ${index + 1}`, slug: `reporting-fixture-${organizationId}`, locationId,
      });
      await models.OrganizationOwner.bulkCreate([
        { organizationId, userId: ids.owner, role: 'owner' },
        { organizationId, userId: managerId, role: 'admin' },
      ]);
      await models.OrganizationEmployee.create({ organizationId, userId: employeeId, status: 'active' });
      await models.OrgAffiliate.create({
        id: affiliateId, organizationId, userId: promoterId, code: `QA-${affiliateId.slice(0, 20)}`,
        defaultCommissionBps: 1000, defaultGuestlistAllocation: 4, status: 'active',
      });
      await models.Event.create({
        id: eventId, creatorUserId: managerId, organizationId, locationId,
        title: `Reporting Fixture Event ${index + 1}`, slug: `reporting-fixture-event-${eventId}`,
        category: 'music', status: 'published', startsAt, endsAt, capacity: 50, guestlistCapacity: 10,
        isDiscoverable: false,
      });
      await models.Offering.create({
        id: ids.offerings[index], eventId, name: 'Fixture Admission', kind: 'ticket', priceCents: 5000,
        currency: 'USD', inventoryMode: 'finite', quantityTotal: 20, quantitySold: 1,
        entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 10, visibility: 'hidden', isActive: true,
      });
      await models.Order.create({
        id: orderId, buyerUserId: buyerId, eventId, status: 'paid', currency: 'USD',
        subtotalCents: 5000, platformFeeCents: 500, totalCents: 5500, affiliateCommissionCents: 500,
        orgAffiliateId: affiliateId, idempotencyKey: `reporting-${orderId}`, paidAt: now,
      });
      await models.OrderItem.create({
        id: ids.items[index], orderId, offeringId: ids.offerings[index], nameSnapshot: 'Fixture Admission',
        kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 5000, lineTotalCents: 5000,
      });
      await models.Ticket.create({
        id: ids.tickets[index], eventId, orderItemId: ids.items[index], holderUserId: buyerId,
        qrTokenHash: createHash('sha256').update(randomUUID()).digest('hex'), status: 'valid',
      });
      await models.GuestlistEntry.create({
        id: ids.guests[index], eventId, userId: buyerId, source: 'event', partySize: 2, status: 'confirmed',
      });
    }

    const permissions = createPermissionService(models);
    const teamService = createTeamService({ models, permissions });
    const businessRead = createBusinessReadService({ models });
    const businessReports = createBusinessReportService({ models, businessRead });
    const teams = await Promise.all(ids.organizations.map((organizationId, index) => teamService.roster(ids.managers[index], organizationId)));
    const query = { days: 30, organizationIds: ids.organizations };
    const overview = await businessRead.overview(ids.owner, reportQuery.parse(query));
    const analytics = await businessReports.summary(ids.owner, reportDetailQuery.parse(query));
    const reportTeam = await businessReports.table(ids.owner, 'team', reportDetailQuery.parse({ ...query, pageSize: 100 }));
    const reportEvents = await businessRead.events(ids.owner, eventPageQuery.parse(query));

    const expectedTeamRows = teams.flatMap((team) => team.people);
    const teamPeople = new Map(expectedTeamRows.map((person) => [person.id, person]));
    const overviewPeople = new Map(reportTeam.items.map((person) => [person.id, person]));
    assert.equal(reportEvents.items.length, 2);
    assert.equal(new Set(reportEvents.items.map((event) => event.locationId)).size, 2);
    assert.deepEqual([...overviewPeople.keys()].sort(), [...teamPeople.keys()].sort());
    assert.equal(teamPeople.size, 7, 'both independent venue teams share only their portfolio owner');

    for (const [id, teamPerson] of teamPeople) {
      const overviewPerson = overviewPeople.get(id);
      const personReport = await businessReports.summary(ids.owner, reportDetailQuery.parse({ ...query, personId: id }));
      assert.equal(overviewPerson.role, teamPerson.role, `${teamPerson.name} Overview role`);
      if (personReport.person) assert.equal(personReport.person.role, teamPerson.role, `${teamPerson.name} Analytics role`);
      assert.equal(overviewPerson.label, teamPerson.name, `${teamPerson.name} Overview name`);
      if (personReport.person) assert.equal(personReport.person.label, teamPerson.name, `${teamPerson.name} Analytics name`);
      for (const field of ['orders', 'salesCents', 'commissionCents']) {
        assert.equal(overviewPerson[field], personReport.summary[field], `${teamPerson.name} ${field}`);
      }
      assert.equal(overviewPerson.approvedGuestlistPlaces, personReport.summary.guestlistPlaces);
    }

    for (const promoterId of ids.promoters) {
      assert.equal(overviewPeople.get(promoterId).salesCents, 5000);
      assert.equal(overviewPeople.get(promoterId).orders, 1);
      assert.equal(overviewPeople.get(promoterId).commissionCents, 500);
    }
    assert.equal(overview.summary.salesCents, 10000);
    assert.equal(overview.summary.orders, 2);
    assert.equal(overview.summary.commissionCents, 1000);
    assert.equal(overview.summary.admissions, 2);
    assert.equal(overview.summary.guestlistPlaces, 4);
    for (const field of ['salesCents', 'orders', 'commissionCents', 'admissions', 'guestlistPlaces']) {
      assert.equal(overview.summary[field], analytics.summary[field], `overview/analytics total ${field}`);
    }

    const { createAdminReportService } = require('../src/services/admin-report-service');
    const adminReports = createAdminReportService({ models, permissions, businessRead, reports: businessReports });
    await assert.rejects(adminReports.bootstrap(ids.owner), { code: 'FORBIDDEN' });
    await assert.rejects(adminReports.summary(ids.owner, reportDetailQuery.parse(query)), { code: 'FORBIDDEN' });
    await assert.rejects(adminReports.table(ids.owner, 'customers', reportDetailQuery.parse(query)), { code: 'FORBIDDEN' });
    await models.User.update({ isInternalAdmin: true }, { where: { id: ids.owner } });
    try {
      const options = await adminReports.bootstrap(ids.owner);
      assert.equal(options.organizations.length, 2);
      assert.ok(options.organizations.every((row) => row.label));
      assert.deepEqual(options.regions, ['Orlando, FL, US', 'Tampa, FL, US']);
      const regions = await adminReports.table(ids.owner, 'regions', reportDetailQuery.parse(query));
      assert.equal(regions.total, 2);
      const venues = await adminReports.table(ids.owner, 'venues', reportDetailQuery.parse({ ...query, regions: [regions.items[0].label] }));
      assert.equal(venues.total, 1);
      const events = await adminReports.table(ids.owner, 'events', reportDetailQuery.parse({ ...query, venueIds: [venues.items[0].id] }));
      assert.equal(events.total, 1);
      const customers = await adminReports.table(ids.owner, 'customers', reportDetailQuery.parse({ ...query, eventId: events.items[0].id }));
      assert.equal(customers.total, 1);
      assert.equal(customers.items[0].salesCents, 5000);
      assert.equal(customers.items[0].units, 1);
      await models.Event.update({ lifecycleState: 'archived' }, { where: { id: ids.events[0] } });
      try {
        assert.equal((await businessReports.summary(ids.owner, reportDetailQuery.parse(query))).summary.salesCents, 5000,
          'business reporting still excludes archived events');
        assert.equal((await adminReports.summary(ids.owner, reportDetailQuery.parse(query))).summary.salesCents, 10000,
          'internal reporting preserves legacy historical sales');
        const history = await adminReports.table(ids.owner, 'events', reportDetailQuery.parse({ ...query, venueIds: [venues.items[0].id] }));
        assert.equal(history.total, 1, 'historical venue drilldown retains archived event rows');
      } finally {
        await models.Event.update({ lifecycleState: 'active' }, { where: { id: ids.events[0] } });
      }
    } finally {
      await models.User.update({ isInternalAdmin: false }, { where: { id: ids.owner } });
    }

    const { QueryTypes, Transaction } = require('sequelize');
    await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
      const prepared = await businessReports.prepareTable(ids.owner, 'team', reportDetailQuery.parse(query), { transaction });
      const rawRows = await sequelize.query(prepared.sql, { replacements: prepared.values, type: QueryTypes.SELECT, transaction });
      assert.deepEqual(rawRows.map(prepared.mapRow), reportTeam.items, 'unbounded export preparation preserves table ordering and mapping');
      const page = await businessReports.table(ids.owner, 'team', reportDetailQuery.parse({ ...query, pageSize: 2 }), { transaction, count: false });
      assert.equal(page.total, null);
      assert.equal(page.hasMore, true);
      assert.deepEqual(page.items, reportTeam.items.slice(0, 2));
      const compiled = await businessReports.summaryQuery(ids.owner, reportDetailQuery.parse(query), { transaction });
      assert.equal((compiled.sql.match(/scoped_events AS MATERIALIZED/g) || []).length, 1, 'summary shares one materialized scope');
      const before = await businessReports.summary(ids.owner, reportDetailQuery.parse(query), { transaction });
      await models.Order.update({ status: 'refunded' }, { where: { id: ids.orders[0] } });
      try {
        const snapshot = await businessReports.summary(ids.owner, reportDetailQuery.parse(query), { transaction });
        assert.deepEqual(snapshot, before, 'all summary metrics use the caller repeatable-read snapshot');
        const latest = await businessReports.summary(ids.owner, reportDetailQuery.parse(query));
        assert.equal(latest.summary.salesCents, 5000);
      } finally {
        await models.Order.update({ status: 'paid' }, { where: { id: ids.orders[0] } });
      }
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      await sequelize.transaction(async (transaction) => {
        const whereEvents = { eventId: { [Op.in]: ids.events } };
        const orderRows = await models.Order.findAll({ where: { id: { [Op.in]: ids.orders } }, attributes: ['id'], transaction });
        const orderIds = orderRows.map((order) => order.id);
        const orderOptions = { transaction };
        await models.CheckIn.destroy({ where: whereEvents, ...orderOptions });
        await models.Ticket.destroy({ where: whereEvents, ...orderOptions });
        await models.Payment.destroy({ where: { orderId: { [Op.in]: ids.orders } }, ...orderOptions });
        await models.AffiliateAttribution.destroy({ where: { eventId: { [Op.in]: ids.events } }, ...orderOptions });
        await models.OrderItem.destroy({ where: { orderId: { [Op.in]: ids.orders } }, ...orderOptions });
        await models.Order.destroy({ where: { id: { [Op.in]: ids.orders } }, ...orderOptions });
        await models.GuestlistEntry.destroy({ where: whereEvents, ...orderOptions });
        await models.Notification.destroy({ where: { eventId: { [Op.in]: ids.events } }, ...orderOptions });
        await models.EventAffiliate.destroy({ where: whereEvents, ...orderOptions });
        await models.Offering.destroy({ where: whereEvents, ...orderOptions });
        await models.Event.destroy({ where: { id: { [Op.in]: ids.events } }, ...orderOptions });
        await models.OrgAffiliate.destroy({ where: { id: { [Op.in]: ids.affiliates } }, ...orderOptions });
        await models.OrganizationOwner.destroy({ where: { organizationId: { [Op.in]: ids.organizations } }, ...orderOptions });
        await models.OrganizationEmployee.destroy({ where: { organizationId: { [Op.in]: ids.organizations } }, ...orderOptions });
        await models.OrganizationVenue.destroy({ where: { organizationId: { [Op.in]: ids.organizations } }, ...orderOptions });
        await models.Organization.destroy({ where: { id: { [Op.in]: ids.organizations } }, ...orderOptions });
        await models.Location.destroy({ where: { id: { [Op.in]: ids.locations } }, ...orderOptions });
        await models.AuditLog.destroy({ where: { organizationId: { [Op.in]: ids.organizations } }, ...orderOptions });
        await models.UserCredential.destroy({ where: { userId: { [Op.in]: users } }, ...orderOptions });
        await models.User.destroy({ where: { id: { [Op.in]: users } }, ...orderOptions });
      });
    } finally {
      await sequelize.close();
    }
  }
});
