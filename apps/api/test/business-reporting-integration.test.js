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
  const { createBusinessService } = require('../src/services/business-service');
  const { createAnalyticsService } = require('../src/services/analytics-service');
  const { createTeamService } = require('../src/services/team-service');
  const { reportQuery } = require('../src/http/business-schemas');
  const { analyticsQuery } = require('../src/http/analytics-schemas');
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
    const businessService = createBusinessService({ models, permissions });
    const analyticsService = createAnalyticsService({ models, permissions });
    const teams = await Promise.all(ids.organizations.map((organizationId, index) => teamService.roster(ids.managers[index], organizationId)));
    const query = { days: 30, organizationIds: ids.organizations };
    const overview = await businessService.workspace(ids.owner, reportQuery.parse(query));
    const analytics = await analyticsService.businessReport(ids.owner, analyticsQuery.parse(query));

    const expectedTeamRows = teams.flatMap((team) => team.people);
    const teamPeople = new Map(expectedTeamRows.map((person) => [person.id, person]));
    const overviewPeople = new Map(overview.report.people.map((person) => [person.id, person]));
    const analyticsPeople = new Map(analytics.referrals.people.map((person) => [person.id, person]));
    assert.equal(overview.events.length, 2);
    assert.equal(new Set(overview.events.map((event) => event.locationId)).size, 2);
    assert.deepEqual([...overviewPeople.keys()].sort(), [...teamPeople.keys()].sort());
    assert.deepEqual([...analyticsPeople.keys()].sort(), [...teamPeople.keys()].sort());
    assert.equal(teamPeople.size, 7, 'both independent venue teams share only their portfolio owner');

    for (const [id, teamPerson] of teamPeople) {
      const overviewPerson = overviewPeople.get(id);
      const analyticsPerson = analyticsPeople.get(id);
      assert.equal(overviewPerson.role, teamPerson.role, `${teamPerson.name} Overview role`);
      assert.equal(analyticsPerson.role, teamPerson.role, `${teamPerson.name} Analytics role`);
      assert.equal(overviewPerson.name, teamPerson.name, `${teamPerson.name} Overview name`);
      assert.equal(analyticsPerson.label, teamPerson.name, `${teamPerson.name} Analytics name`);
      for (const field of ['orders', 'salesCents', 'commissionCents', 'guestlistRequests', 'guestlistPlaces', 'approvedGuestlistPlaces']) {
        assert.equal(overviewPerson[field], analyticsPerson[field], `${teamPerson.name} ${field}`);
      }
    }

    for (const promoterId of ids.promoters) {
      assert.equal(overviewPeople.get(promoterId).salesCents, 5000);
      assert.equal(overviewPeople.get(promoterId).orders, 1);
      assert.equal(overviewPeople.get(promoterId).commissionCents, 500);
    }
    assert.equal(overview.report.summary.salesCents, 10000);
    assert.equal(overview.report.summary.orders, 2);
    assert.equal(overview.report.summary.commissionCents, 1000);
    assert.equal(overview.report.summary.admissions, 2);
    assert.equal(overview.report.summary.guestlistPlaces, 4);
    for (const field of ['salesCents', 'orders', 'commissionCents', 'admissions', 'guestlistPlaces']) {
      assert.equal(overview.report.summary[field], analytics.summary[field], `workspace/analytics total ${field}`);
    }
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
