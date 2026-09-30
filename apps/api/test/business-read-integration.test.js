const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Webhook } = require('svix');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('business read APIs enforce scope, stable pagination, correct aggregates, and synthetic instruction delivery history', async (t) => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const { signToken } = require('../src/services/auth-service');
  const config = getConfig();
  const sequelize = createSequelize(config);
  const m = initModels(sequelize);
  const ids = {
    owner: randomUUID(), manager: randomUUID(), employee: randomUUID(), promoter: randomUUID(),
    otherPromoter: randomUUID(), independent: randomUUID(), buyer: randomUUID(), buyerTwo: randomUUID(),
    buyerThree: randomUUID(), rejectedGuest: randomUUID(), organization: randomUUID(), location: randomUUID(),
    promoterOrgAffiliate: randomUUID(), otherOrgAffiliate: randomUUID(), mainEvent: randomUUID(), independentEvent: randomUUID(),
    promoterEventAffiliate: randomUUID(), otherEventAffiliate: randomUUID(), ga: randomUUID(), vip: randomUUID(),
    promoterOrder: randomUUID(), otherOrder: randomUUID(), directOrder: randomUUID(),
  };
  const idsForEvents = Array.from({ length: 503 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const teamUserIds = Array.from({ length: 105 }, () => randomUUID());
  const eventIds = [ids.mainEvent, ...idsForEvents.slice(1)];
  const users = [ids.owner, ids.manager, ids.employee, ids.promoter, ids.otherPromoter, ids.independent,
    ids.buyer, ids.buyerTwo, ids.buyerThree, ids.rejectedGuest];
  const now = new Date();
  const paidAt = new Date(now.getTime() - 60_000);
  const startsAt = new Date(now.getTime() + 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60_000);
  const hookSecret = `whsec_${Buffer.from('nitewide isolated delivery test secret').toString('base64')}`;
  let server;
  let disabledWebhookServer;

  try {
    await sequelize.authenticate();
    await m.User.bulkCreate(users.map((id, index) => ({
      id,
      email: `business-read-${id}@fixture.nitewide.test`,
      displayName: ['Fixture Owner', 'Fixture Manager', 'Fixture Employee', 'Fixture Promoter', 'Other Promoter', 'Independent Creator', 'Buyer A', 'Buyer B', 'Buyer C', 'Rejected Guest'][index],
      phone: id === ids.buyerThree ? '+14155550193' : null,
      isActive: true,
      independentCreator: id === ids.independent,
    })));
    await m.User.bulkCreate(teamUserIds.map((id, index) => ({
      id, email: `business-team-roster-${String(index).padStart(3, '0')}@fixture.nitewide.test`,
      displayName: `Fixture Roster ${String(index).padStart(3, '0')}`, isActive: true,
    })));
    await m.Location.create({ id: ids.location, name: 'Fixture Room', addressLine1: '1 Test Way', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' });
    await m.Organization.create({ id: ids.organization, name: 'Read Fixture Org', slug: `read-fixture-${ids.organization}`, locationId: ids.location });
    await m.OrganizationOwner.bulkCreate([
      { organizationId: ids.organization, userId: ids.owner, role: 'owner' },
      { organizationId: ids.organization, userId: ids.manager, role: 'admin' },
      // A former organization owner may still have a separately-authorized
      // affiliate relationship, but that relationship must never restore
      // organization management privileges.
      { organizationId: ids.organization, userId: ids.promoter, role: 'owner', lifecycleState: 'suspended' },
    ]);
    await m.OrganizationEmployee.create({ organizationId: ids.organization, userId: ids.employee, status: 'active' });
    await m.OrganizationEmployee.bulkCreate(teamUserIds.map((userId) => ({ organizationId: ids.organization, userId, status: 'active' })));
    await m.TeamInvitation.bulkCreate(teamUserIds.map((userId, index) => ({
      organizationId: ids.organization, invitedByUserId: ids.owner,
      email: `business-team-invite-${String(index).padStart(3, '0')}@fixture.nitewide.test`, role: 'employee',
      tokenHash: createHash('sha256').update(`invitation-${userId}`).digest('hex'),
      expiresAt: new Date(now.getTime() + 7 * 86400000),
    })));
    await m.OrgAffiliate.bulkCreate([
      { id: ids.promoterOrgAffiliate, organizationId: ids.organization, userId: ids.promoter, code: `PROMO-${ids.promoter.slice(0, 8)}`, defaultCommissionBps: 1000, defaultGuestlistAllocation: 4, status: 'active' },
      { id: ids.otherOrgAffiliate, organizationId: ids.organization, userId: ids.otherPromoter, code: `PROMO-${ids.otherPromoter.slice(0, 8)}`, defaultCommissionBps: 1000, defaultGuestlistAllocation: 4, status: 'active' },
    ]);
    await m.Event.bulkCreate(eventIds.map((id, index) => ({
      id,
      creatorUserId: ids.manager,
      organizationId: ids.organization,
      locationId: ids.location,
      title: 'Same-time Fixture Event',
      slug: `read-fixture-${index}`,
      summary: 'Isolated API fixture',
      description: '',
      category: 'music',
      status: 'published',
      startsAt,
      endsAt,
      capacity: 100,
      guestlistCapacity: 20,
      isDiscoverable: false,
    })));
    await m.Event.create({
      id: ids.independentEvent, creatorUserId: ids.independent, organizationId: null, locationId: ids.location,
      title: 'Independent Fixture Event', slug: `read-independent-${ids.independentEvent}`, category: 'private',
      status: 'published', startsAt, endsAt, capacity: 20, guestlistCapacity: 5, isDiscoverable: false,
    });
    await m.EventAffiliate.bulkCreate([
      { id: ids.promoterEventAffiliate, eventId: ids.mainEvent, userId: ids.promoter, orgAffiliateId: ids.promoterOrgAffiliate, code: `EVENT-${ids.promoter.slice(0, 8)}`, commissionBps: 1000, guestlistAllocation: 4, status: 'active' },
      { id: ids.otherEventAffiliate, eventId: ids.mainEvent, userId: ids.otherPromoter, orgAffiliateId: ids.otherOrgAffiliate, code: `EVENT-${ids.otherPromoter.slice(0, 8)}`, commissionBps: 1000, guestlistAllocation: 4, status: 'active' },
    ]);
    await m.Offering.bulkCreate([
      { id: ids.ga, eventId: ids.mainEvent, name: 'General Admission', kind: 'ticket', priceCents: 2000, inventoryMode: 'finite', quantityTotal: 100, quantitySold: 2, isActive: true, sortOrder: 0 },
      { id: ids.vip, eventId: ids.mainEvent, name: 'VIP Package', kind: 'package', priceCents: 3000, inventoryMode: 'finite', quantityTotal: 50, quantitySold: 1, entriesPerUnit: 2, isActive: true, sortOrder: 1 },
    ]);
    await m.Order.bulkCreate([
      { id: ids.promoterOrder, buyerUserId: ids.buyer, eventId: ids.mainEvent, status: 'paid', currency: 'USD', subtotalCents: 5000, platformFeeCents: 500, totalCents: 5500, affiliateCommissionCents: 500, eventAffiliateId: ids.promoterEventAffiliate, idempotencyKey: `read-${ids.promoterOrder}`, paidAt },
      { id: ids.otherOrder, buyerUserId: ids.buyerTwo, eventId: ids.mainEvent, status: 'paid', currency: 'USD', subtotalCents: 7000, platformFeeCents: 700, totalCents: 7700, affiliateCommissionCents: 700, eventAffiliateId: ids.otherEventAffiliate, idempotencyKey: `read-${ids.otherOrder}`, paidAt },
      { id: ids.directOrder, buyerUserId: ids.buyer, eventId: ids.mainEvent, status: 'paid', currency: 'USD', subtotalCents: 9000, platformFeeCents: 900, totalCents: 9900, affiliateCommissionCents: 0, idempotencyKey: `read-${ids.directOrder}`, paidAt },
    ]);
    const itemIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await m.OrderItem.bulkCreate([
      { id: itemIds[0], orderId: ids.promoterOrder, offeringId: ids.ga, nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
      { id: itemIds[1], orderId: ids.promoterOrder, offeringId: ids.vip, nameSnapshot: 'VIP Package', kindSnapshot: 'package', quantity: 1, entriesPerUnitSnapshot: 2, unitPriceCents: 3000, lineTotalCents: 3000 },
      { id: itemIds[2], orderId: ids.otherOrder, offeringId: ids.ga, nameSnapshot: 'General Admission', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 7000, lineTotalCents: 7000 },
      { id: itemIds[3], orderId: ids.directOrder, offeringId: ids.vip, nameSnapshot: 'VIP Package', kindSnapshot: 'package', quantity: 1, entriesPerUnitSnapshot: 2, unitPriceCents: 9000, lineTotalCents: 9000 },
    ]);
    await m.OrderItem.bulkCreate(Array.from({ length: 13 }, (_, index) => ({
      id: randomUUID(), orderId: ids.directOrder, offeringId: ids.vip, nameSnapshot: `Fixture zero line ${String(index + 1).padStart(2, '0')}`,
      kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 0, lineTotalCents: 0,
    })));
    await m.Event.update({ title: '=HYPERLINK("https://bad.example","click")' }, { where: { id: idsForEvents.at(-1) } });
    const ticketItems = [
      [0, ids.buyer], [1, ids.buyer], [0, ids.buyer], [1, ids.buyer],
      [2, ids.buyerTwo], [2, ids.buyerTwo], [3, ids.buyer], [3, ids.buyer],
    ];
    await m.Ticket.bulkCreate(ticketItems.map(([itemIndex, holderUserId], index) => ({
      id: randomUUID(), eventId: ids.mainEvent, orderItemId: itemIds[itemIndex], holderUserId,
      qrTokenHash: createHash('sha256').update(randomUUID()).digest('hex'), status: index === 0 ? 'checked_in' : 'valid',
    })));
    await m.GuestlistEntry.bulkCreate([
      { id: randomUUID(), eventId: ids.mainEvent, userId: ids.buyer, eventAffiliateId: ids.promoterEventAffiliate, source: 'affiliate', partySize: 3, status: 'confirmed' },
      { id: randomUUID(), eventId: ids.mainEvent, userId: ids.buyerThree, source: 'event', partySize: 2, status: 'pending' },
      { id: randomUUID(), eventId: ids.mainEvent, userId: ids.rejectedGuest, source: 'event', partySize: 6, status: 'rejected' },
    ]);

    const emailMock = {
      enabled: true,
      async queue({ key, to, template }, transaction) {
        const [row] = await m.EmailOutbox.findOrCreate({ where: { dedupeKey: key }, defaults: { dedupeKey: key, recipientEmail: to, templateAlias: template }, transaction });
        return row.id;
      },
    };
    const secretConfig = { ...config, RESEND_WEBHOOK_SECRET: hookSecret, NODE_ENV: 'production', MEDIA_UPLOAD_DIR: require('node:os').tmpdir() };
    server = createApp({ sequelize, models: m, config: secretConfig, services: { email: emailMock } }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tokenFor = async (userId) => {
      const issuedAt = Math.floor(Date.now() / 1000);
      const session = await m.AuthSession.create({ userId, expiresAt: new Date((issuedAt + 300) * 1000) });
      return signToken({ sub: userId, sid: session.id, iat: issuedAt, exp: issuedAt + 300, pwd: null }, config.AUTH_TOKEN_SECRET);
    };
    async function request(path, userId, { method = 'GET', body, headers = {} } = {}) {
      const token = userId ? await tokenFor(userId) : null;
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }

    await t.test('bootstrap returns role-scoped organizations and venues', async () => {
    const missingAuth = await request('/business/bootstrap', null);
    assert.equal(missingAuth.status, 401);
    const bootstrap = await request('/business/bootstrap', ids.owner);
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.data.organizations.length, 1);
    assert.equal(bootstrap.body.data.venues.length, 1);
    for (const userId of [ids.manager, ids.employee, ids.promoter]) {
      const roleBootstrap = await request('/business/bootstrap', userId);
      assert.deepEqual([roleBootstrap.body.data.organizations.length, roleBootstrap.body.data.venues.length], [1, 1]);
      if (userId === ids.promoter) assert.equal(roleBootstrap.body.data.organizations[0].canManage, false);
    }
    const independentBootstrap = await request('/business/bootstrap', ids.independent);
    assert.deepEqual([independentBootstrap.body.data.organizations.length, independentBootstrap.body.data.scope.canCreateIndependent], [0, true]);
    });

    await t.test('organization roster and invitation lists are bounded and manager-only', async () => {
    const teamPageOne = await request(`/business/organizations/${ids.organization}/team-page?page=1&pageSize=100&sort=name_asc`, ids.owner);
    const teamPageTwo = await request(`/business/organizations/${ids.organization}/team-page?page=2&pageSize=100&sort=name_asc`, ids.owner);
    assert.deepEqual([teamPageOne.body.data.total, teamPageOne.body.data.items.length, teamPageTwo.body.data.items.length], [110, 100, 10]);
    assert.deepEqual([...teamPageOne.body.data.items, ...teamPageTwo.body.data.items].map((row) => row.name),
      [...teamPageOne.body.data.items, ...teamPageTwo.body.data.items].map((row) => row.name).toSorted((a, b) => a.localeCompare(b)));
    assert.equal((await request(`/business/organizations/${ids.organization}/team-page?search=Roster%20010&role=Employee`, ids.manager)).body.data.total, 1);
    assert.equal((await request(`/business/organizations/${ids.organization}/team-page?role=Promoter`, ids.manager)).body.data.total, 2);
    assert.equal((await request(`/business/organizations/${ids.organization}/team-page`, ids.employee)).status, 403);
    assert.equal((await request(`/business/organizations/${ids.organization}/team-page`, ids.promoter)).status, 403, 'a former owner with active affiliate access cannot inspect organization roster');
    const invitePageOne = await request(`/business/organizations/${ids.organization}/invitations-page?page=1&pageSize=100`, ids.manager);
    const invitePageTwo = await request(`/business/organizations/${ids.organization}/invitations-page?page=2&pageSize=100`, ids.manager);
    assert.deepEqual([invitePageOne.body.data.total, invitePageOne.body.data.items.length, invitePageTwo.body.data.items.length], [105, 100, 5]);
    assert.equal((await request(`/business/organizations/${ids.organization}/invitations-page`, ids.promoter)).status, 403);
    });

    await t.test('event pagination, role scope, overview, and attention counts stay aligned', async () => {
    for (const userId of [ids.owner, ids.manager, ids.employee, ids.promoter]) {
      const pages = [];
      for (let page = 1; page <= 6; page += 1) {
        const result = await request(`/business/events?page=${page}&pageSize=100&sort=starts_asc&status=all`, userId);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.total, 503);
        assert.equal(result.body.data.page, page);
        pages.push(...result.body.data.items.map((event) => event.id));
      }
      assert.equal(new Set(pages).size, 503, 'pagination returns every authorized event exactly once');
      assert.deepEqual(pages, [...pages].sort(), 'equal-start-time sort ties are stable by event ID');
      assert.equal((await request('/business/events?pageSize=0', userId)).status, 422);
      assert.equal((await request('/business/events?from=2026-09-30T00%3A00%3A00Z&to=2026-09-29T00%3A00%3A00Z', userId)).status, 422);
    }
    const employeePage = await request('/business/events?page=1&pageSize=1&sort=starts_asc', ids.employee);
    assert.deepEqual(employeePage.body.data.counts, { upcoming: 503, past: 0, draft: 0 });
    assert.equal(employeePage.body.data.items[0].canManage, false);
    const promoterPage = await request('/business/events?page=1&pageSize=1&sort=starts_asc', ids.promoter);
    assert.equal(promoterPage.body.data.items[0].canManage, false);
    assert.equal(promoterPage.body.data.items[0].canEdit, false);
    const ownerSalesSort = await request('/business/events?page=1&pageSize=1&sort=sales_desc', ids.owner);
    const promoterSalesSort = await request('/business/events?page=1&pageSize=1&sort=sales_desc', ids.promoter);
    assert.deepEqual([ownerSalesSort.body.data.items[0].id, ownerSalesSort.body.data.items[0].lifetimeSales.salesCents,
      promoterSalesSort.body.data.items[0].id, promoterSalesSort.body.data.items[0].lifetimeSales.salesCents],
    [ids.mainEvent, 21000, ids.mainEvent, 5000], 'sales sorting and totals use each user’s authorized order scope');
    const revokedOwnerSummary = await request(`/business/events/${ids.mainEvent}/summary`, ids.promoter);
    assert.deepEqual([revokedOwnerSummary.status, revokedOwnerSummary.body.data.scope, revokedOwnerSummary.body.data.summary.salesCents], [200, 'own', 5000]);
    assert.equal((await request('/business/events', ids.independent)).body.data.total, 1);

    const ownerOverview = await request('/business/overview?days=30', ids.owner);
    const employeeOverview = await request('/business/overview?days=30', ids.employee);
    const promoterOverview = await request('/business/overview?days=30', ids.promoter);
    assert.deepEqual([ownerOverview.body.data.summary.salesCents, ownerOverview.body.data.summary.orders], [21000, 3]);
    assert.deepEqual([employeeOverview.body.data.summary.salesCents, employeeOverview.body.data.summary.orders], [0, 0]);
    assert.deepEqual([promoterOverview.body.data.summary.salesCents, promoterOverview.body.data.summary.orders, promoterOverview.body.data.scope], [5000, 1, 'own']);
    const attentionPromoter = await request('/business/overview/needs-attention', ids.promoter);
    assert.equal(attentionPromoter.status, 200);
    assert.equal(attentionPromoter.body.data.counts.pendingGuestlist, 0, 'a promoter must not receive another person’s guestlist request');
    });

    await t.test('event sales and attendee/guestlist details do not multiply or cross scopes', async () => {
    const summaryOwner = await request(`/business/events/${ids.mainEvent}/summary`, ids.owner);
    assert.equal(summaryOwner.status, 200);
    assert.deepEqual([summaryOwner.body.data.summary.salesCents, summaryOwner.body.data.summary.orders, summaryOwner.body.data.summary.admissions, summaryOwner.body.data.summary.guestlistPlaces], [21000, 3, 8, 3]);
    assert.ok(summaryOwner.body.data.teamSales.length <= 7, 'team sales shows at most six attributed rows plus the direct-sales row');
    assert.deepEqual(summaryOwner.body.data.teamSales.map((row) => [row.id, row.salesCents]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [['direct', 9000], [ids.otherPromoter, 7000], [ids.promoter, 5000]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    'bounded team sales retains direct revenue and does not inflate attributed totals');
    assert.deepEqual(summaryOwner.body.data.tiers.map((tier) => tier.salesCents), [9000, 12000]);
    const summaryPromoter = await request(`/business/events/${ids.mainEvent}/summary`, ids.promoter);
    assert.deepEqual([summaryPromoter.body.data.scope, summaryPromoter.body.data.summary.salesCents, summaryPromoter.body.data.summary.orders, summaryPromoter.body.data.summary.admissions], ['own', 5000, 1, 4]);
    const purchases = await request(`/business/events/${ids.mainEvent}/purchases?page=1&pageSize=1`, ids.owner);
    const purchasesPageTwo = await request(`/business/events/${ids.mainEvent}/purchases?page=2&pageSize=1`, ids.owner);
    const purchasesPageThree = await request(`/business/events/${ids.mainEvent}/purchases?page=3&pageSize=1`, ids.owner);
    const purchaseIds = [purchases.body.data.items[0].id, purchasesPageTwo.body.data.items[0].id, purchasesPageThree.body.data.items[0].id];
    assert.deepEqual([purchases.body.data.total, purchaseIds], [3, [ids.promoterOrder, ids.otherOrder, ids.directOrder].sort().reverse()]);
    const promoterPurchases = await request(`/business/events/${ids.mainEvent}/purchases?page=1&pageSize=10`, ids.promoter);
    assert.deepEqual([promoterPurchases.body.data.total, promoterPurchases.body.data.items[0].salesCents], [1, 5000]);
    const attendeesOwner = await request(`/business/events/${ids.mainEvent}/attendees?page=1&pageSize=10`, ids.owner);
    const buyerSummary = attendeesOwner.body.data.items.find((item) => item.id === ids.buyer);
    assert.deepEqual([attendeesOwner.body.data.total, buyerSummary.salesCents, buyerSummary.orders, buyerSummary.admissions, buyerSummary.checkedIn, buyerSummary.guestlistPlaces], [4, 14000, 2, 6, 1, 3]);
    const attendeePromoter = await request(`/business/events/${ids.mainEvent}/attendees/${ids.buyer}?page=1&pageSize=10`, ids.promoter);
    assert.deepEqual([attendeePromoter.body.data.purchases.total, attendeePromoter.body.data.purchases.items.length], [2, 2]);
    await m.OrderItem.update({ quantity: 3 }, { where: { orderId: ids.directOrder, nameSnapshot: 'Fixture zero line 01' } });
    const quantityAscending = await request(`/business/events/${ids.mainEvent}/attendees/${ids.buyer}?page=1&pageSize=30&sortKey=quantity&descending=false`, ids.owner);
    const quantityDescending = await request(`/business/events/${ids.mainEvent}/attendees/${ids.buyer}?page=1&pageSize=30&sortKey=quantity&descending=true`, ids.owner);
    assert.deepEqual([quantityAscending.body.data.purchases.items[0].quantity, quantityDescending.body.data.purchases.items[0].quantity], [1, 3]);
    const nameAscending = await request(`/business/events/${ids.mainEvent}/attendees/${ids.buyer}?page=1&pageSize=30&sortKey=name&descending=false`, ids.owner);
    assert.deepEqual(nameAscending.body.data.purchases.items.map((item) => item.name),
      nameAscending.body.data.purchases.items.map((item) => item.name).toSorted((a, b) => a.localeCompare(b)), 'attendee purchase names sort alphabetically');
    assert.equal((await request(`/business/events/${ids.mainEvent}/attendees/${ids.buyerTwo}`, ids.promoter)).status, 404);
    const guestlistOwner = await request(`/business/events/${ids.mainEvent}/guestlist-page?status=pending&page=1&pageSize=10`, ids.owner);
    assert.equal(guestlistOwner.body.data.total, 1);
    assert.equal(guestlistOwner.body.data.items[0].status, 'pending');
    const multiStatusGuestlist = await request(`/business/events/${ids.mainEvent}/guestlist-page?statuses=pending&statuses=confirmed&page=1&pageSize=10`, ids.owner);
    assert.deepEqual([multiStatusGuestlist.body.data.total, multiStatusGuestlist.body.data.items.map((row) => row.status).sort()], [2, ['confirmed', 'pending']]);
    const guestByPhone = await request(`/business/events/${ids.mainEvent}/guestlist-page?search=%2B14155550193&page=1&pageSize=1`, ids.owner);
    assert.deepEqual([guestByPhone.body.data.total, guestByPhone.body.data.items.length, guestByPhone.body.data.items[0].guestPhone], [1, 1, '+14155550193']);
    const guestByReferrer = await request(`/business/events/${ids.mainEvent}/guestlist-page?search=Fixture%20Promoter&page=1&pageSize=1`, ids.owner);
    assert.deepEqual([guestByReferrer.body.data.total, guestByReferrer.body.data.items.length, guestByReferrer.body.data.items[0].guestName], [1, 1, 'Buyer A']);
    const sourceAscending = await request(`/business/events/${ids.mainEvent}/guestlist-page?page=1&pageSize=10&sortKey=sourceValue&descending=false`, ids.owner);
    assert.deepEqual(sourceAscending.body.data.items.map((row) => row.referrerName || 'Direct'), ['Direct', 'Direct', 'Fixture Promoter'], 'guestlist source sorting preserves direct and referral rows');
    const people = await request(`/business/events/${ids.mainEvent}/people-page?page=1&pageSize=20&sortKey=name&descending=false`, ids.owner);
    const peopleById = new Map(people.body.data.items.map((row) => [row.userId, row]));
    assert.equal(people.body.data.items.find((row) => row.role === 'Owner').isCurrentMember, true);
    assert.equal(peopleById.get(ids.employee).isCurrentMember, true);
    assert.equal(peopleById.get(ids.promoter).isCurrentMember, true, 'organization affiliates remain marked as current members in the event roster');
    const promoterAssignment = await m.EventAffiliate.findByPk(ids.promoterEventAffiliate);
    await promoterAssignment.update({ commissionBps: null });
    const inheritedCommission = await request(`/business/events/${ids.mainEvent}/people-page?search=Fixture%20Promoter&page=1&pageSize=5`, ids.owner);
    await promoterAssignment.update({ commissionBps: 0 });
    const explicitZeroCommission = await request(`/business/events/${ids.mainEvent}/people-page?search=Fixture%20Promoter&page=1&pageSize=5`, ids.owner);
    await promoterAssignment.update({ commissionBps: 1000 });
    assert.equal(inheritedCommission.body.data.items[0].commissionBps, 1000, 'a null event commission inherits the organization affiliate rate');
    assert.equal(explicitZeroCommission.body.data.items[0].commissionBps, 0, 'an explicit zero commission overrides the organization affiliate rate');
    const guestlistPromoter = await request(`/business/events/${ids.mainEvent}/guestlist-page?page=1&pageSize=10`, ids.promoter);
    assert.deepEqual([guestlistPromoter.body.data.total, guestlistPromoter.body.data.items[0].guestName], [1, 'Buyer A']);
    assert.equal((await request(`/business/events/${ids.mainEvent}/summary`, ids.independent)).status, 404);
    });

    await t.test('reporting uses filtered totals, stable pages, safe CSV, and own-only scope', async () => {
    const businessReport = await request('/business/reports/summary?days=30', ids.owner);
    assert.deepEqual([businessReport.status, businessReport.body.data.summary.salesCents, businessReport.body.data.summary.orders,
      businessReport.body.data.summary.admissions, businessReport.body.data.summary.guestlistPlaces], [200, 21000, 3, 8, 3]);
    assert.deepEqual([businessReport.body.data.range.timezone, businessReport.body.data.range.currency, businessReport.body.data.range.basis], ['UTC', 'USD', 'paidAt']);
    const paidDate = paidAt.toISOString().slice(0, 10);
    const zeroFilledStart = new Date(new Date(`${paidDate}T00:00:00.000Z`).getTime() - 2 * 86400000).toISOString().slice(0, 10);
    const zeroFilledMiddle = new Date(new Date(`${paidDate}T00:00:00.000Z`).getTime() - 86400000).toISOString().slice(0, 10);
    const zeroFilledEnd = paidDate;
    const zeroFilledDaily = await request(`/business/reports/summary?startDate=${zeroFilledStart}&endDate=${zeroFilledEnd}`, ids.owner);
    assert.deepEqual(zeroFilledDaily.body.data.daily.map((row) => [row.date, row.orders, row.salesCents]), [
      [zeroFilledStart, 0, 0],
      [zeroFilledMiddle, 0, 0],
      [zeroFilledEnd, 3, 21000],
    ], 'daily report includes zero-valued dates in its requested range');
    assert.deepEqual(zeroFilledDaily.body.data.regionalMix.map((row) => [row.label, row.salesCents, row.level]), [['Orlando, FL, US', 21000, 'region']]);
    assert.equal(businessReport.body.data.offerings.length, 13, 'offering mix is bounded to top 12 plus Other');
    assert.equal(businessReport.body.data.offerings.at(-1).label, 'Other');
    assert.equal(businessReport.body.data.offerings.reduce((sum, row) => sum + row.salesCents, 0), 21000, 'item and ticket joins do not multiply the offering-sales total');
    const reportEventsOne = await request('/business/reports/events?page=1&pageSize=1&sort=sales_desc', ids.owner);
    const reportEventsTwo = await request('/business/reports/events?page=2&pageSize=1&sort=sales_desc', ids.owner);
    assert.deepEqual([reportEventsOne.body.data.total, reportEventsOne.body.data.items[0].id, reportEventsTwo.body.data.page], [503, ids.mainEvent, 2]);
    assert.equal((await request('/business/reports/events?sort=not_allowed', ids.owner)).status, 422);
    const rewindSearch = 'Same-time%20Fixture%20Event';
    const rewindRegion = await request(`/business/reports/regions?days=30&search=${rewindSearch}&page=1&pageSize=5`, ids.owner);
    const rewindVenue = await request(`/business/reports/venues?days=30&search=${rewindSearch}&page=1&pageSize=5`, ids.owner);
    const rewindEvents = await request(`/business/reports/events?days=30&search=${rewindSearch}&page=1&pageSize=100`, ids.owner);
    const rewindSummary = await request(`/business/reports/summary?days=30&search=${rewindSearch}`, ids.owner);
    assert.deepEqual([rewindRegion.body.data.total, rewindRegion.body.data.items[0].label,
      rewindRegion.body.data.items[0].events, rewindRegion.body.data.items[0].orders,
      rewindRegion.body.data.items[0].salesCents], [1, 'Orlando, FL, US', 502, 3, 21000],
    'event-title search matches the containing region and aggregates only matching events');
    assert.deepEqual([rewindVenue.body.data.total, rewindVenue.body.data.items[0].label,
      rewindVenue.body.data.items[0].events, rewindVenue.body.data.items[0].orders,
      rewindVenue.body.data.items[0].salesCents], [1, 'Fixture Room', 502, 3, 21000],
    'the same event-title search matches the containing venue with consistent totals');
    assert.deepEqual([rewindEvents.body.data.total, rewindEvents.body.data.items.length,
      rewindEvents.body.data.items.find((row) => row.id === ids.mainEvent)?.orders,
      rewindEvents.body.data.items.find((row) => row.id === ids.mainEvent)?.salesCents], [502, 100, 3, 21000],
    'event rows, count, and pagination retain the same shared search scope');
    assert.deepEqual([rewindSummary.body.data.summary.events, rewindSummary.body.data.summary.orders,
      rewindSummary.body.data.summary.salesCents], [502, 3, 21000],
    'the report summary and all hierarchy tables use the same event-title search scope');
    const promoterReport = await request('/business/reports/summary?days=30', ids.promoter);
    assert.deepEqual([promoterReport.body.data.summary.salesCents, promoterReport.body.data.summary.orders], [5000, 1]);
    const ownTeam = await request('/business/reports/team?page=1&pageSize=20', ids.promoter);
    assert.equal(ownTeam.body.data.items.some((row) => row.label === 'Other Promoter' || row.label === 'Direct sales'), false);
    assert.deepEqual([ownTeam.body.data.total, ownTeam.body.data.items[0].id, ownTeam.body.data.items[0].role], [1, ids.promoter, 'Promoter'], 'promoter sees only their own participant row');
    const fullTeam = await request('/business/reports/team?page=1&pageSize=100&sort=role_asc', ids.owner);
    const fullTeamPageTwo = await request('/business/reports/team?page=2&pageSize=100&sort=role_asc', ids.owner);
    const teamRows = [...fullTeam.body.data.items, ...fullTeamPageTwo.body.data.items];
    assert.equal(fullTeam.body.data.total, 110, 'team count includes active participants with no recent sales');
    assert.deepEqual([...new Set(teamRows.map((row) => row.role))].sort(), ['Employee', 'Manager', 'Owner', 'Promoter']);
    assert.ok(teamRows.every((row) => Number.isFinite(row.salesCents) && Number.isFinite(row.guestlistPlaces)), 'zero-sales member and guestlist totals are explicit numeric values');
    assert.deepEqual(teamRows.map((row) => `${row.role}:${row.id}`), [...teamRows].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id)).map((row) => `${row.role}:${row.id}`), 'role sorting remains stable across page boundaries');
    const ownersOnly = await request('/business/reports/team?page=1&pageSize=20&roles=Owner', ids.owner);
    const managersOnly = await request('/business/reports/team?page=1&pageSize=20&roles=Manager', ids.owner);
    const promotersOnly = await request('/business/reports/team?page=1&pageSize=20&roles=Promoter', ids.owner);
    assert.deepEqual([ownersOnly.body.data.total, ownersOnly.body.data.items[0].label, managersOnly.body.data.items[0].label], [1, 'Fixture Owner', 'Fixture Manager']);
    assert.deepEqual(promotersOnly.body.data.items.map((row) => row.role), ['Promoter', 'Promoter']);
    const promoterSalesDescending = await request('/business/reports/team?page=1&pageSize=20&roles=Promoter&sort=sales_desc', ids.owner);
    const promoterSalesAscending = await request('/business/reports/team?page=1&pageSize=20&roles=Promoter&sort=sales_asc', ids.owner);
    assert.deepEqual(promoterSalesDescending.body.data.items.map((row) => [row.id, row.salesCents]), [[ids.otherPromoter, 7000], [ids.promoter, 5000]], 'sales descending returns the higher credited subtotal first');
    assert.deepEqual(promoterSalesAscending.body.data.items.map((row) => [row.id, row.salesCents]), [[ids.promoter, 5000], [ids.otherPromoter, 7000]], 'sales ascending returns the lower credited subtotal first');
    const rolesFilteredTeam = await request('/business/reports/team?page=1&pageSize=100&roles=Employee&roles=Promoter&personSearch=Fixture', ids.owner);
    assert.ok(rolesFilteredTeam.body.data.items.length > 0);
    assert.ok(rolesFilteredTeam.body.data.items.every((row) => ['Employee', 'Promoter'].includes(row.role) && row.label.includes('Fixture')));
    assert.equal(rolesFilteredTeam.body.data.items.some((row) => row.role === 'Referral' || row.label === 'Direct sales'), false, 'direct-sales and channel aggregates are not participant rows');
    const customRange = await request(`/business/reports/summary?startDate=${paidDate}&endDate=${paidDate}`, ids.owner);
    assert.equal(customRange.body.data.summary.salesCents, 21000, 'custom UTC paidAt range includes today’s fixture orders');
    const csvToken = await tokenFor(ids.owner);
    const csvResponse = await fetch(`${base}/business/reports/export.csv?days=30`, { headers: { authorization: `Bearer ${csvToken}` } });
    const csv = await csvResponse.text();
    assert.equal(csvResponse.status, 200);
    assert.match(csv, /'="?HYPERLINK/);
    assert.equal(csv.includes('@fixture.nitewide.test'), false, 'CSV does not expose customer emails');

    const crossEventOrderId = randomUUID();
    await m.Order.create({ id: crossEventOrderId, buyerUserId: ids.buyer, eventId: eventIds[1], status: 'paid', currency: 'USD',
      subtotalCents: 2500, platformFeeCents: 250, totalCents: 2750, affiliateCommissionCents: 0,
      idempotencyKey: `cross-event-customer-${crossEventOrderId}`, paidAt });
    const crossEventOfferingId = randomUUID();
    await m.Offering.create({ id: crossEventOfferingId, eventId: eventIds[1], name: 'Peer event exclusive offering', kind: 'ticket',
      priceCents: 2500, inventoryMode: 'finite', quantityTotal: 10, isActive: true, sortOrder: 0 });
    await m.OrderItem.create({ id: randomUUID(), orderId: crossEventOrderId, offeringId: crossEventOfferingId,
      nameSnapshot: 'Peer event exclusive offering',
      kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 2500, lineTotalCents: 2500 });
    const customerReport = await request('/business/reports/customers?page=1&pageSize=5&search=Buyer%20A&sort=sales_desc', ids.owner);
    assert.deepEqual([customerReport.body.data.total, customerReport.body.data.items[0].id,
      customerReport.body.data.items[0].orders, customerReport.body.data.items[0].salesCents], [2, ids.buyer, 3, 16500],
    'customer reporting aggregates the same buyer across matching scoped events while retaining other buyers in those events');
    assert.equal(Object.hasOwn(customerReport.body.data.items[0], 'eventId'), false, 'customer rows are not incorrectly event-bound');

    const eventScope = `eventId=${ids.mainEvent}`;
    const scopedSummary = await request(`/business/reports/summary?${eventScope}`, ids.owner);
    assert.deepEqual([scopedSummary.body.data.event?.id, scopedSummary.body.data.event?.label,
      scopedSummary.body.data.summary.events, scopedSummary.body.data.summary.orders,
      scopedSummary.body.data.summary.customers, scopedSummary.body.data.summary.salesCents],
    [ids.mainEvent, 'Same-time Fixture Event', 1, 3, 2, 21000],
    'event-scoped summary identifies the selection and excludes activity from other events');
    for (const privateField of ['platformFeeCents', 'totalCents', 'customerFeesCents']) {
      assert.equal(Object.hasOwn(scopedSummary.body.data.summary, privateField), false,
        `event-scoped analytics never exposes private ${privateField}`);
    }
    const scopedOfferings = await request(`/business/reports/offerings?${eventScope}&page=1&pageSize=20`, ids.owner);
    assert.equal(scopedOfferings.body.data.items.some((row) => row.label === 'Peer event exclusive offering'), false,
      'offering rows exclude peer-event purchases');
    assert.equal(scopedOfferings.body.data.items.reduce((sum, row) => sum + row.salesCents, 0), 21000,
      'offering sales reconcile to the selected event only');
    const scopedCustomers = await request(`/business/reports/customers?${eventScope}&page=1&pageSize=20`, ids.owner);
    assert.deepEqual(scopedCustomers.body.data.items.map((row) => [row.id, row.orders, row.salesCents])
      .sort((a, b) => a[0].localeCompare(b[0])), [[ids.buyer, 2, 14000], [ids.buyerTwo, 1, 7000]]
      .sort((a, b) => a[0].localeCompare(b[0])), 'customer aggregates include purchases from the selected event only');
    assert.equal(scopedCustomers.body.data.items.some((row) => Object.hasOwn(row, 'platformFeeCents') || Object.hasOwn(row, 'totalCents')), false,
      'event-scoped customer rows omit private fee and charged-total fields');
    const scopedTeamPageOne = await request(`/business/reports/team?${eventScope}&page=1&pageSize=100`, ids.owner);
    const scopedTeamPageTwo = await request(`/business/reports/team?${eventScope}&page=2&pageSize=100`, ids.owner);
    const scopedTeamRows = [...scopedTeamPageOne.body.data.items, ...scopedTeamPageTwo.body.data.items];
    assert.equal(scopedTeamRows.some((row) => row.id === ids.otherPromoter && row.salesCents > 0), true,
      'team attribution includes the selected event’s other promoter');
    assert.deepEqual([scopedTeamRows.reduce((sum, row) => sum + row.orders, 0),
      scopedTeamRows.reduce((sum, row) => sum + row.salesCents, 0)], [2, 12000],
    'team credited sales are bounded to selected-event affiliate orders');

    const scopedExportToken = await tokenFor(ids.owner);
    const selectedOfferingScope = `${eventScope}&personId=${ids.promoter}&offeringKind=ticket&offeringName=${encodeURIComponent('General Admission')}`;
    const selectedOfferingSummary = await request(`/business/reports/summary?${selectedOfferingScope}`, ids.owner);
    assert.deepEqual([selectedOfferingSummary.status, selectedOfferingSummary.body.data.summary.salesCents,
      selectedOfferingSummary.body.data.summary.orders, selectedOfferingSummary.body.data.summary.customers,
      selectedOfferingSummary.body.data.summary.commissionCents, selectedOfferingSummary.body.data.summary.commissionBasis],
    [200, 2000, 1, 1, null, 'unavailable_at_offering_level'],
    'person + offering analytics count only selected line value from the mixed-offering credited order');
    const selectedOfferingRows = await request(`/business/reports/offerings?${selectedOfferingScope}&pageSize=20`, ids.owner);
    assert.deepEqual(selectedOfferingRows.body.data.items.map((row) => [row.label, row.units, row.orders, row.salesCents]),
      [['General Admission', 1, 1, 2000]], 'the person-offering table excludes other offerings from the same order');
    const selectedOfferingCustomers = await request(`/business/reports/customers?${selectedOfferingScope}&pageSize=20`, ids.owner);
    assert.deepEqual(selectedOfferingCustomers.body.data.items.map((row) => [row.label, row.orders, row.salesCents]),
      [['Buyer A', 1, 2000]], 'customers of an offering use only selected line totals and authorized participant orders');
    const selectedOfferingTeam = await request(`/business/reports/team?${selectedOfferingScope}&pageSize=20`, ids.owner);
    assert.deepEqual(selectedOfferingTeam.body.data.items.map((row) => [row.id, row.salesCents, row.commissionCents, row.commissionBasis]),
      [[ids.promoter, 2000, null, 'unavailable_at_offering_level']],
    'offering-specific team attribution marks unavailable order-level commission as unknown, not zero');
    const missingOfferingPair = await request(`/business/reports/summary?${eventScope}&offeringKind=ticket`, ids.owner);
    assert.equal(missingOfferingPair.status, 422, 'offering kind and name must be supplied together');
    const absentOffering = await request(`/business/reports/customers?${eventScope}&personId=${ids.promoter}&offeringKind=ticket&offeringName=Not%20this%20offering`, ids.owner);
    assert.deepEqual([absentOffering.status, absentOffering.body.data.total, absentOffering.body.data.items], [200, 0, []],
      'a nonexistent offering name produces an empty customer report rather than broadening scope');
    const unauthorizedPerson = await request(`/business/reports/customers?${eventScope}&personId=${ids.promoter}&offeringKind=ticket&offeringName=General%20Admission`, ids.independent);
    assert.deepEqual([unauthorizedPerson.status, unauthorizedPerson.body.data.total, unauthorizedPerson.body.data.items], [200, 0, []],
      'a user outside the selected event/person scope gets no fallback rows');
    const selectedOfferingCsvResponse = await fetch(`${base}/business/reports/export.csv?exportTable=customers&${selectedOfferingScope}`, {
      headers: { authorization: `Bearer ${scopedExportToken}` },
    });
    const selectedOfferingCsv = await selectedOfferingCsvResponse.text();
    assert.equal(selectedOfferingCsvResponse.status, 200);
    assert.match(selectedOfferingCsv, /Buyer A/);
    assert.match(selectedOfferingCsv, /20\.00/);
    assert.equal(selectedOfferingCsv.includes('Buyer B'), false,
      'the all-row CSV follows the same selected offering/person scope as the customer table');

    const scopedExportResponse = await fetch(`${base}/business/reports/export.csv?eventId=${ids.mainEvent}&sort=role_desc&days=30`, {
      headers: { authorization: `Bearer ${scopedExportToken}` },
    });
    const scopedExport = await scopedExportResponse.text();
    assert.equal(scopedExportResponse.status, 200, 'event-scoped export accepts a table-specific sort and normalizes it for each exported section');
    assert.ok(scopedExport.includes(ids.mainEvent) && scopedExport.includes('General Admission') && scopedExport.includes('VIP Package'),
      'event-scoped export includes the selected event and its offerings');
    assert.equal(scopedExport.includes('Peer event exclusive offering'), false,
      'event-scoped export excludes offerings from peer events');

    const selectedEventsExportResponse = await fetch(`${base}/business/reports/export.csv?exportTable=events&days=30`, {
      headers: { authorization: `Bearer ${scopedExportToken}` },
    });
    const selectedEventsExport = await selectedEventsExportResponse.text();
    const selectedEventsExportRows = selectedEventsExport.trim().split(/\r?\n/);
    assert.equal(selectedEventsExportResponse.status, 200);
    assert.equal(selectedEventsExportRows.length, 504,
      'selected-table CSV iterates beyond its 100-row server page and emits all 503 authorized events plus one header');
    assert.match(selectedEventsExportRows[0], /^"Event","Status","Starts at",/);
    assert.match(selectedEventsExport, /'="?HYPERLINK/,
      'selected-table CSV neutralizes formula-leading event titles');

    const selectedCustomersExportResponse = await fetch(`${base}/business/reports/export.csv?exportTable=customers&${eventScope}&days=30`, {
      headers: { authorization: `Bearer ${scopedExportToken}` },
    });
    const selectedCustomersExport = await selectedCustomersExportResponse.text();
    assert.equal(selectedCustomersExportResponse.status, 200);
    assert.match(selectedCustomersExport.split(/\r?\n/, 1)[0], /^"Customer","Email","Paid orders","Sales USD","Units"$/);
    assert.match(selectedCustomersExport, /Buyer A/);
    assert.match(selectedCustomersExport, /Buyer B/);
    assert.equal(selectedCustomersExport.includes('platformFeeCents') || selectedCustomersExport.includes('totalCents'), false,
      'selected customer CSV contains no fee or charged-total fields');
    assert.equal(selectedCustomersExport.includes('@fixture.nitewide.test'), true,
      'customer export retains the selected buyers’ report email column');
    assert.equal(selectedCustomersExport.includes('Peer event exclusive offering'), false,
      'customer CSV is scoped to the selected event rather than peer purchases');

    const selectedTeamExportResponse = await fetch(`${base}/business/reports/export.csv?exportTable=team&roles=Promoter&personSearch=Fixture&days=30`, {
      headers: { authorization: `Bearer ${scopedExportToken}` },
    });
    const selectedTeamExport = await selectedTeamExportResponse.text();
    assert.equal(selectedTeamExportResponse.status, 200);
    const selectedTeamTable = await request('/business/reports/team?roles=Promoter&personSearch=Fixture&days=30&pageSize=100', ids.owner);
    assert.equal(selectedTeamExport.trim().split(/\r?\n/).length, selectedTeamTable.body.data.total + 1,
      'selected Team CSV honors role and person filters and matches the table’s full result count');
    assert.match(selectedTeamExport, /Promoter/);

    const unavailableExportResponse = await fetch(`${base}/business/reports/export.csv?exportTable=customers&${eventScope}&days=30`, {
      headers: { authorization: `Bearer ${await tokenFor(ids.independent)}` },
    });
    const unavailableExport = await unavailableExportResponse.text();
    assert.equal(unavailableExportResponse.status, 200);
    assert.equal(unavailableExport.trim().split(/\r?\n/).length, 1,
      'an unauthorized selected-event export returns only its header and never falls back to broad data');

    const promoterEventScope = `eventId=${ids.mainEvent}`;
    const promoterScopedSummary = await request(`/business/reports/summary?${promoterEventScope}`, ids.promoter);
    assert.deepEqual([promoterScopedSummary.body.data.event?.id, promoterScopedSummary.body.data.summary.salesCents,
      promoterScopedSummary.body.data.summary.orders, promoterScopedSummary.body.data.summary.customers],
    [ids.mainEvent, 5000, 1, 1], 'own-only event scope retains only the promoter’s credited sales');
    const promoterScopedOfferings = await request(`/business/reports/offerings?${promoterEventScope}&pageSize=20`, ids.promoter);
    assert.deepEqual(promoterScopedOfferings.body.data.items.map((row) => [row.label, row.salesCents])
      .sort((a, b) => a[0].localeCompare(b[0])),
      [['General Admission', 2000], ['VIP Package', 3000]].sort((a, b) => a[0].localeCompare(b[0])),
    'own-only offering details exclude uncredited orders from the same event');
    const promoterScopedCustomers = await request(`/business/reports/customers?${promoterEventScope}&pageSize=20`, ids.promoter);
    assert.deepEqual(promoterScopedCustomers.body.data.items.map((row) => [row.id, row.orders, row.salesCents]),
      [[ids.buyer, 1, 5000]], 'own-only customer details exclude customers reached only through other event sales');
    const promoterScopedTeam = await request(`/business/reports/team?${promoterEventScope}&pageSize=20`, ids.promoter);
    assert.equal(promoterScopedTeam.body.data.items.some((row) => row.id === ids.otherPromoter || row.label === 'Direct sales'), false,
      'own-only team details never reveal other promoters or direct sales');

    const inaccessibleSummary = await request(`/business/reports/summary?${eventScope}`, ids.independent);
    assert.deepEqual([inaccessibleSummary.status, inaccessibleSummary.body.data.event,
      inaccessibleSummary.body.data.summary.events, inaccessibleSummary.body.data.summary.orders,
      inaccessibleSummary.body.data.summary.salesCents], [200, null, 0, 0, 0],
    'an inaccessible event selection returns an empty report without falling back to all events');
    for (const kind of ['offerings', 'customers', 'team']) {
      const inaccessibleTable = await request(`/business/reports/${kind}?${eventScope}&pageSize=20`, ids.independent);
      assert.deepEqual([inaccessibleTable.status, inaccessibleTable.body.data.total, inaccessibleTable.body.data.items], [200, 0, []],
        `${kind} never leaks rows when the selected event is outside the user’s scope`);
    }

    const activityPageOne = await request('/business/reports/events?page=1&pageSize=1&activityOnly=true&sort=orders_asc', ids.owner);
    const activityPageTwo = await request('/business/reports/events?page=2&pageSize=1&activityOnly=true&sort=orders_asc', ids.owner);
    assert.deepEqual([activityPageOne.body.data.total, activityPageOne.body.data.items[0].id,
      activityPageTwo.body.data.items[0].id], [2, eventIds[1], ids.mainEvent],
    'activity-only filtering applies before event report counts and page boundaries');

    const fixtureLocation = await m.Location.findByPk(ids.location);
    let unnamedVenueReport;
    await fixtureLocation.update({ name: null });
    try {
      unnamedVenueReport = await request('/business/reports/venues?page=1&pageSize=5&sort=name_asc', ids.owner);
    } finally {
      await fixtureLocation.update({ name: 'Fixture Room' });
    }
    assert.deepEqual([unnamedVenueReport.body.data.total, unnamedVenueReport.body.data.items[0].label,
      unnamedVenueReport.body.data.items[0].venueAddress], [1, '1 Test Way', '1 Test Way'],
    'venues with no name remain grouped using their address fallback');
    });

    await t.test('reporting local calendar days use IANA DST boundaries and local daily buckets', async () => {
    const dated = [
      ['2026-03-08T04:59:59.000Z', 100], ['2026-03-08T05:00:00.000Z', 200],
      ['2026-03-09T03:59:59.000Z', 300], ['2026-03-09T04:00:00.000Z', 400],
      ['2026-11-01T03:59:59.000Z', 500], ['2026-11-01T04:00:00.000Z', 600],
      ['2026-11-02T04:59:59.000Z', 700], ['2026-11-02T05:00:00.000Z', 800],
    ];
    await m.Order.bulkCreate(dated.map(([instant, amount]) => ({ id: randomUUID(), buyerUserId: ids.buyerThree,
      eventId: ids.mainEvent, status: 'paid', currency: 'USD', subtotalCents: amount, totalCents: amount,
      idempotencyKey: `local-report-${instant}`, paidAt: new Date(instant) })));
    const spring = await request('/business/reports/summary?startDate=2026-03-08&endDate=2026-03-08&timezone=America%2FNew_York', ids.owner);
    assert.equal(spring.status, 200);
    assert.deepEqual([spring.body.data.range.since, spring.body.data.range.until, spring.body.data.summary.salesCents],
      ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 500], 'spring-forward day spans 23 hours');
    assert.deepEqual(spring.body.data.daily.map((row) => [row.date, row.salesCents]), [['2026-03-08', 500]]);
    const autumn = await request('/business/reports/summary?startDate=2026-11-01&endDate=2026-11-01&timezone=America%2FNew_York', ids.owner);
    assert.deepEqual([autumn.body.data.range.since, autumn.body.data.range.until, autumn.body.data.summary.salesCents],
      ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 1300], 'fall-back day spans 25 hours');
    assert.deepEqual(autumn.body.data.daily.map((row) => [row.date, row.salesCents]), [['2026-11-01', 1300]]);
    assert.equal((await request('/business/reports/summary?timezone=Not%2FAZone', ids.owner)).status, 422);
    });

    await t.test('optional notification preferences suppress only in-app alerts', async () => {
    assert.equal((await request('/auth/notification-preferences', null)).status, 401);
    const defaults = await request('/auth/notification-preferences', ids.manager);
    assert.deepEqual(defaults.body.data, { reviewRequests: true, salesActivity: true, inventoryAlerts: true });
    const disabled = { reviewRequests: false, salesActivity: false, inventoryAlerts: false };
    assert.deepEqual((await request('/auth/notification-preferences', ids.manager, { method: 'PATCH', body: disabled })).body.data, disabled);
    assert.equal((await request('/auth/notification-preferences', ids.manager)).body.data.salesActivity, false);
    assert.equal((await request('/auth/notification-preferences', ids.owner)).body.data.salesActivity, true, 'preferences are user-scoped');
    assert.equal((await request('/auth/notification-preferences', ids.manager, { method: 'PATCH', body: { ...disabled, extra: true } })).status, 422, 'unknown preference properties are rejected');

    const { createNotificationService } = require('../src/services/notification-service');
    const notifications = createNotificationService(m);
    const beforeEmail = await m.EmailOutbox.count();
    const beforeNotifications = await m.Notification.count({ where: { userId: ids.manager } });
    for (const kind of ['guestlist_request', 'referral_purchase', 'event_purchase', 'offering_sold_out']) {
      assert.equal(await notifications.emit({ userId: ids.manager, eventId: ids.mainEvent, kind, title: 'Optional alert', message: 'Fixture only' }), null, `${kind} respects its opt-out`);
    }
    const essential = await notifications.emit({ userId: ids.manager, eventId: ids.mainEvent, kind: 'guestlist_approved', title: 'Booking update', message: 'Fixture only' });
    assert.ok(essential, 'booking outcomes remain enabled regardless of optional preferences');
    assert.equal(await m.Notification.count({ where: { userId: ids.manager } }), beforeNotifications + 1);
    assert.equal(await m.EmailOutbox.count(), beforeEmail, 'in-app preference checks do not enqueue or send email');
    });

    await t.test('team copying accepts completed sources but not cross-workspace or member access', async () => {
    const reuseIds = { sourceEvent: randomUUID(), targetEvent: randomUUID(), otherOrganization: randomUUID(), otherTarget: randomUUID(), sourceOrder: randomUUID() };
    const pastStartsAt = new Date(now.getTime() - 30 * 86_400_000);
    await m.Organization.create({ id: reuseIds.otherOrganization, name: 'Other Reuse Workspace', slug: `reuse-other-${reuseIds.otherOrganization}`, locationId: ids.location });
    await m.OrganizationOwner.create({ organizationId: reuseIds.otherOrganization, userId: ids.manager, role: 'admin' });
    await m.Event.bulkCreate([
      { id: reuseIds.sourceEvent, creatorUserId: ids.manager, organizationId: ids.organization, locationId: ids.location,
        title: 'Completed Source Night', slug: `reuse-source-${reuseIds.sourceEvent}`, category: 'music', status: 'completed',
        startsAt: pastStartsAt, endsAt: new Date(pastStartsAt.getTime() + 4 * 60 * 60_000), capacity: 100, guestlistCapacity: 20, isDiscoverable: false },
      { id: reuseIds.targetEvent, creatorUserId: ids.manager, organizationId: ids.organization, locationId: ids.location,
        title: 'New Draft', slug: `reuse-target-${reuseIds.targetEvent}`, category: 'music', status: 'draft',
        startsAt, endsAt, capacity: 100, guestlistCapacity: 20, isDiscoverable: false },
      { id: reuseIds.otherTarget, creatorUserId: ids.manager, organizationId: reuseIds.otherOrganization, locationId: ids.location,
        title: 'Other Workspace Draft', slug: `reuse-target-${reuseIds.otherTarget}`, category: 'music', status: 'draft',
        startsAt, endsAt, capacity: 100, guestlistCapacity: 20, isDiscoverable: false },
    ]);
    const sourceAssignments = [
      { id: randomUUID(), eventId: reuseIds.sourceEvent, userId: ids.promoter, orgAffiliateId: ids.promoterOrgAffiliate, code: `PAST-${randomUUID()}`, commissionBps: 1200, guestlistAllocation: 4, status: 'active' },
      { id: randomUUID(), eventId: reuseIds.sourceEvent, userId: ids.otherPromoter, orgAffiliateId: ids.otherOrgAffiliate, code: `PAST-${randomUUID()}`, commissionBps: 800, guestlistAllocation: 3, status: 'active' },
    ];
    await m.EventAffiliate.bulkCreate(sourceAssignments);
    await m.Order.create({ id: reuseIds.sourceOrder, buyerUserId: ids.buyer, eventId: reuseIds.sourceEvent, status: 'paid', currency: 'USD',
      subtotalCents: 2500, platformFeeCents: 250, totalCents: 2750, affiliateCommissionCents: 300,
      eventAffiliateId: sourceAssignments[0].id, idempotencyKey: `reuse-${reuseIds.sourceOrder}`, paidAt });
    await m.GuestlistEntry.create({ eventId: reuseIds.sourceEvent, userId: ids.buyerTwo, eventAffiliateId: sourceAssignments[0].id,
      source: 'affiliate', partySize: 2, status: 'confirmed' });
    const copyRequest = () => request(`/business/events/${reuseIds.targetEvent}/copy-access`, ids.manager, { method: 'POST', body: { sourceEventId: reuseIds.sourceEvent, copyTeam: true, copyAllocations: false } });
    const copied = await copyRequest();
    const copiedAgain = await copyRequest();
    assert.deepEqual([copied.status, copied.body.data.copied, copied.body.data.copyAllocations, copiedAgain.body.data.copied], [200, 2, false, 0], 'completed source teams can be copied idempotently into a new draft');
    const targetAssignments = await m.EventAffiliate.findAll({ where: { eventId: reuseIds.targetEvent }, order: [['userId', 'ASC']] });
    assert.equal(targetAssignments.length, 2);
    assert.ok(targetAssignments.every((row) => !sourceAssignments.some((source) => source.code === row.code)), 'new assignments receive fresh referral codes');
    assert.ok(targetAssignments.every((row) => row.guestlistAllocation === 0), 'guestlist capacity does not copy without opt-in');
    assert.deepEqual([await m.Order.count({ where: { eventId: reuseIds.sourceEvent } }), await m.Order.count({ where: { eventId: reuseIds.targetEvent } }),
      await m.GuestlistEntry.count({ where: { eventId: reuseIds.sourceEvent } }), await m.GuestlistEntry.count({ where: { eventId: reuseIds.targetEvent } })], [1, 0, 1, 0], 'orders and guestlist history never copy');
    assert.equal((await request(`/business/events/${reuseIds.otherTarget}/copy-access`, ids.manager, { method: 'POST', body: { sourceEventId: reuseIds.sourceEvent, copyTeam: true, copyAllocations: true } })).status, 403, 'even a manager of both organizations cannot copy assignments across workspaces');
    assert.equal((await request(`/business/events/${reuseIds.targetEvent}/copy-access`, ids.promoter, { method: 'POST', body: { sourceEventId: reuseIds.sourceEvent, copyTeam: true, copyAllocations: true } })).status, 403, 'promoters cannot use workspace assignment copy');
    });

    await t.test('instruction preview, idempotency, signed delivery webhooks, and privacy', async () => {
    const outboxBeforePreview = await m.EmailOutbox.count();
    const preview = await request(`/business/events/${ids.mainEvent}/instructions/preview`, ids.manager, { method: 'POST', body: { instructions: 'Use the north entrance after 9 PM.' } });
    assert.deepEqual([preview.status, preview.body.data.audienceCount, preview.body.data.delivery], [200, 3, 'configured']);
    assert.equal(await m.EmailOutbox.count(), outboxBeforePreview, 'preview never queues an email');
    assert.equal((await request(`/business/events/${ids.mainEvent}/instructions/preview`, ids.employee, { method: 'POST', body: { instructions: 'Use the north entrance after 9 PM.' } })).status, 403);
    assert.equal((await request(`/business/events/${ids.mainEvent}/instructions/preview`, ids.promoter, { method: 'POST', body: { instructions: 'Use the north entrance after 9 PM.' } })).status, 403, 'a revoked owner with surviving affiliate access cannot send organization instructions');
    const idempotencyKey = randomUUID();
    const send = () => request(`/business/events/${ids.mainEvent}/instructions`, ids.manager, { method: 'POST', body: { instructions: 'Use the north entrance after 9 PM.', idempotencyKey } });
    const queued = await send();
    const replayed = await send();
    const conflict = await request(`/business/events/${ids.mainEvent}/instructions`, ids.manager, { method: 'POST', body: { instructions: 'Use a different entrance.', idempotencyKey } });
    assert.deepEqual([queued.status, queued.body.data.queued, replayed.body.data.queued, conflict.status], [202, 3, 3, 409]);
    const historyBeforeDelivery = await request(`/business/events/${ids.mainEvent}/instructions/history?page=1&pageSize=10`, ids.manager);
    assert.equal(historyBeforeDelivery.body.data.total, 1);
    const historyItem = historyBeforeDelivery.body.data.items[0];
    assert.equal(historyItem.statusCounts.pending, 3);
    assert.equal(historyItem.trackingConfigured, true);
    assert.equal(JSON.stringify(historyItem).includes('@fixture.nitewide.test'), false, 'history never exposes recipient email addresses');

    const signing = new Webhook(hookSecret);
    async function webhookRequest(payload, { messageId = `msg_${randomUUID()}`, timestamp = new Date(), signatureBody } = {}) {
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signed = signing.sign(messageId, timestamp, signatureBody === undefined ? rawBody : signatureBody);
      return fetch(`${base}/webhooks/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'svix-id': messageId, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': signed },
        body: rawBody,
      });
    }
    assert.equal((await fetch(`${base}/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await webhookRequest({ type: 'email.delivered', created_at: now.toISOString(), data: { email_id: 'provider-tampered' } }, { signatureBody: Buffer.from('different signed body') })).status, 400);
    assert.equal((await webhookRequest({ type: 'email.delivered', created_at: now.toISOString(), data: { email_id: 'provider-early' } }, { timestamp: new Date(Date.now() - 10 * 60_000) })).status, 400);
    assert.equal((await webhookRequest({ type: 'email.unknown', created_at: now.toISOString(), data: { email_id: 'provider-unknown' } })).status, 204);
    assert.equal(await m.EmailDeliveryEvent.count(), 0, 'unknown signed event types are ignored');
    const earlyEvent = { type: 'email.delivered', created_at: now.toISOString(), data: { email_id: 'provider-early' } };
    const earlyWebhookId = `msg_${randomUUID()}`;
    assert.equal((await webhookRequest(earlyEvent, { messageId: earlyWebhookId })).status, 204);
    const outbox = await m.EmailOutbox.findOne({ where: { dedupeKey: { [require('sequelize').Op.like]: `event/${ids.mainEvent}/instructions-%` } } });
    assert.ok(outbox);
    await outbox.update({ providerMessageId: 'provider-early' });
    assert.equal((await webhookRequest({ type: 'email.sent', created_at: new Date(now.getTime() + 1000).toISOString(), data: { email_id: 'provider-early' } }, { messageId: earlyWebhookId })).status, 204);
    const historyAfterDelivery = await request(`/business/events/${ids.mainEvent}/instructions/history?page=1&pageSize=10`, ids.manager);
    assert.deepEqual([historyAfterDelivery.body.data.items[0].statusCounts.delivered, historyAfterDelivery.body.data.items[0].statusCounts.pending], [1, 2]);
    assert.equal((await request(`/business/events/${ids.mainEvent}/instructions/history`, ids.promoter)).status, 403);
    const storedEvent = await m.EmailDeliveryEvent.findOne({ where: { webhookId: earlyWebhookId } });
    assert.deepEqual([storedEvent.eventType, storedEvent.providerMessageId], ['email.delivered', 'provider-early']);
    assert.equal(JSON.stringify(storedEvent.toJSON()).includes('@fixture.nitewide.test'), false);

    disabledWebhookServer = createApp({ sequelize, models: m, config: { ...secretConfig, RESEND_WEBHOOK_SECRET: '' }, services: { email: emailMock } }).listen(0, '127.0.0.1');
    await new Promise((resolve) => disabledWebhookServer.once('listening', resolve));
    const disabledResponse = await fetch(`http://127.0.0.1:${disabledWebhookServer.address().port}/api/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(disabledResponse.status, 503, 'a missing webhook secret is reported as unavailable');
    });

    await t.test('needs-attention guestlist preview and count share the one-hour expiry cutoff', async () => {
    const attentionNow = new Date('2026-09-30T12:00:00.000Z');
    const attentionCases = [
      { label: 'future', startsAt: new Date(attentionNow.getTime() + 86400000), endsAt: new Date(attentionNow.getTime() + 2 * 86400000), included: true },
      { label: 'ongoing', startsAt: new Date(attentionNow.getTime() - 30 * 60000), endsAt: new Date(attentionNow.getTime() + 30 * 60000), included: true },
      { label: 'ended 30 minutes ago', startsAt: new Date(attentionNow.getTime() - 5 * 3600000), endsAt: new Date(attentionNow.getTime() - 30 * 60000), included: true },
      { label: 'ended exactly one hour ago', startsAt: new Date(attentionNow.getTime() - 5 * 3600000), endsAt: new Date(attentionNow.getTime() - 3600000), included: true },
      { label: 'ended one hour and one millisecond ago', startsAt: new Date(attentionNow.getTime() - 5 * 3600000), endsAt: new Date(attentionNow.getTime() - 3600001), included: false },
      { label: 'ended earlier', startsAt: new Date(attentionNow.getTime() - 8 * 3600000), endsAt: new Date(attentionNow.getTime() - 4 * 3600000), included: false },
    ].map((item) => ({ ...item, eventId: randomUUID(), affiliateId: randomUUID(), entryId: randomUUID() }));
    await m.Event.bulkCreate(attentionCases.map(({ eventId, label, startsAt: eventStartsAt, endsAt: eventEndsAt }) => ({
      id: eventId, creatorUserId: ids.manager, organizationId: ids.organization, locationId: ids.location,
      title: `Guestlist attention ${label}`, slug: `attention-${eventId}`, category: 'music', status: 'published',
      startsAt: eventStartsAt, endsAt: eventEndsAt, capacity: 100, guestlistCapacity: 20, isDiscoverable: false,
    })));
    await m.EventAffiliate.bulkCreate(attentionCases.map(({ eventId, affiliateId }) => ({
      id: affiliateId, eventId, userId: ids.promoter, orgAffiliateId: ids.promoterOrgAffiliate,
      code: `ATTENTION-${affiliateId.slice(0, 8)}`, commissionBps: 1000, guestlistAllocation: 4, status: 'active',
    })));
    await m.GuestlistEntry.bulkCreate(attentionCases.map(({ eventId, affiliateId, entryId }) => ({
      id: entryId, eventId, userId: ids.buyer, eventAffiliateId: affiliateId, source: 'affiliate', partySize: 1, status: 'pending',
    })));
    const { createBusinessReadService } = require('../src/services/business-read-service');
    const attentionService = createBusinessReadService({ models: m, now: () => attentionNow });
    const requestHistoryBeforeAttention = await m.GuestlistEntry.count({ where: { id: attentionCases.map(({ entryId }) => entryId) } });
    const attentionResult = await attentionService.needsAttention(ids.promoter, {});
    const eligibleAttentionIds = attentionCases.filter(({ included }) => included).map(({ eventId }) => eventId).sort();
    assert.equal(attentionResult.counts.pendingGuestlist, eligibleAttentionIds.length,
      'pending guestlist count includes requests for future, ongoing, and events ended within the one-hour window');
    assert.deepEqual(attentionResult.items.filter(({ kind }) => kind === 'pending_guestlist').map(({ eventId }) => eventId).sort(), eligibleAttentionIds,
      'needs-attention preview uses the same inclusive one-hour event cutoff as its count');
    assert.deepEqual([requestHistoryBeforeAttention,
      await m.GuestlistEntry.count({ where: { id: attentionCases.map(({ entryId }) => entryId) } })], [attentionCases.length, attentionCases.length],
    'expiry only filters needs-attention results and leaves pending guestlist history intact');
    });
  } finally {
    if (disabledWebhookServer) await new Promise((resolve) => disabledWebhookServer.close(resolve));
    if (server) await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  }
});
