const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { request: httpRequest } = require('./support/http-client.cjs');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createApp } = require('../src/app');
const { signToken } = require('../src/services/auth-service');
const { buildContract } = require('../src/http/contract-build');
const { mutationTransaction, AUTHORIZATION_FENCE } = require('../src/services/mutation-transaction');

function gate() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function waitForFenceWaiter(sequelize) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await sequelize.query(`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory'
      AND classid=:namespace AND objid=:key AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
    { replacements: { namespace: AUTHORIZATION_FENCE[0], key: AUTHORIZATION_FENCE[1] }, type: QueryTypes.SELECT });
    if (row.count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected the customer action to wait for an access/lifecycle change');
}

test('Customer My events follows existing business scopes and guards live actions within transactions', { timeout: 60000 }, async (t) => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const config = require('../src/config').getConfig();
  const contracts = buildContract().contracts;
  const sequelize = createSequelize(config), m = initModels(sequelize);
  const roles = ['owner', 'manager', 'employee', 'promoter', 'orgPromoter', 'venueManager', 'venueEmployee', 'venuePromoter', 'ordinary', 'pending', 'buyer', 'readOnlyUnassigned', 'readOnlyMember', 'operations'];
  const ids = Object.fromEntries([...roles, 'org', 'location', 'otherLocation', 'live', 'upcoming', 'past', 'completed', 'draft',
    'ownerAffiliate', 'employeeAffiliate', 'promoterAffiliate', 'venueEmployeeAffiliate', 'venuePromoterAffiliate',
    'venueManagerGrant', 'venueEmployeeGrant', 'venuePromoterGrant', 'directEntry', 'employeeEntry', 'promoterEntry', 'pastEntry'].map((key) => [key, randomUUID()]));
  const tokens = new Map();
  let server;
  const now = Date.now();
  try {
    await m.User.bulkCreate(roles.map((role) => ({ id: ids[role], email: `${role}-${ids.org}@offline.nitewide.test`,
      displayName: `My events ${role}`, onboardingPending: role === 'pending',
      isInternalAdmin: role.startsWith('readOnly') || role === 'operations',
      internalAdminRole: role.startsWith('readOnly') ? 'read_only' : role === 'operations' ? 'operations' : null })));
    await m.Location.bulkCreate([
      { id: ids.location, name: 'Assigned Room', city: 'Orlando', timezone: 'America/New_York' },
      { id: ids.otherLocation, name: 'Other Room', city: 'Orlando', timezone: 'America/New_York' },
    ]);
    await m.Organization.create({ id: ids.org, name: 'My events organization', slug: `my-events-${ids.org}`, locationId: ids.location });
    await m.OrganizationVenue.create({ organizationId: ids.org, locationId: ids.otherLocation });
    await m.OrganizationOwner.bulkCreate([
      { organizationId: ids.org, userId: ids.owner, role: 'owner' },
      { organizationId: ids.org, userId: ids.manager, role: 'admin' },
      { organizationId: ids.org, userId: ids.pending, role: 'admin' },
    ]);
    await m.OrganizationEmployee.bulkCreate(['employee', 'readOnlyMember'].map((role) => ({ organizationId: ids.org, userId: ids[role] })));
    await m.OrgAffiliate.create({ organizationId: ids.org, userId: ids.orgPromoter, code: `ORG-${randomUUID()}`,
      defaultCommissionBps: 1000, defaultGuestlistAllocation: 5 });
    await m.VenueAccess.bulkCreate(['venueManager', 'venueEmployee', 'venuePromoter'].map((role) => ({
      id: ids[`${role}Grant`], organizationId: ids.org, locationId: ids.location, userId: ids[role],
      role: { venueManager: 'manager', venueEmployee: 'employee', venuePromoter: 'promoter' }[role],
    })));
    await m.Event.bulkCreate(['live', 'upcoming', 'past', 'completed', 'draft'].map((kind) => ({
      id: ids[kind], organizationId: ids.org, creatorUserId: ids.owner, locationId: kind === 'upcoming' ? ids.otherLocation : ids.location,
      title: `My events ${kind}`, slug: `my-events-${kind}-${ids.org}`, guestlistCapacity: 40,
      status: kind === 'completed' ? 'completed' : kind === 'draft' ? 'draft' : 'published',
      startsAt: new Date(now + (kind === 'past' ? -4 : kind === 'live' ? -1 : 2) * 3600000),
      endsAt: new Date(now + (kind === 'past' ? -2 : 4) * 3600000),
    })));
    // Merely creating a historical legacy event grants no business entry gate.
    await m.Event.create({ creatorUserId: ids.ordinary, title: 'Unapproved legacy creator', slug: `ordinary-${ids.org}`,
      status: 'published', startsAt: new Date(now + 3600000), endsAt: new Date(now + 7200000) });
    await m.EventAffiliate.bulkCreate(['owner', 'employee', 'promoter', 'venueEmployee', 'venuePromoter'].map((role) => ({
      id: ids[`${role}Affiliate`], eventId: ids.live, userId: ids[role], code: `MY-${randomUUID()}`, commissionBps: 1000,
      guestlistAllocation: 10, accessScope: role.startsWith('venue') ? 'venue' : role === 'promoter' ? 'event' : 'organization',
      venueAccessId: role.startsWith('venue') ? ids[`${role}Grant`] : null,
    })));
    await m.Offering.create({ eventId: ids.live, name: 'Private ticket', priceCents: 2000, visibility: 'password', accessCodeHash: 'a'.repeat(64), quantityTotal: 50 });
    const orders = await m.Order.bulkCreate(['owner', 'employee', 'promoter'].map((role, index) => ({
      buyerUserId: ids.buyer, eventId: ids.live, eventAffiliateId: ids[`${role}Affiliate`], status: 'paid',
      subtotalCents: (index + 1) * 2000, totalCents: (index + 1) * 2000, affiliateCommissionCents: (index + 1) * 200,
      idempotencyKey: randomUUID(), paidAt: new Date(),
    })), { returning: true });
    await m.Payment.bulkCreate([0, 2].map((index) => ({ orderId: orders[index].id, provider: 'demo', providerReference: randomUUID(), status: 'succeeded', amountCents: orders[index].totalCents })));
    await m.Order.bulkCreate([
      { buyerUserId: ids.buyer, eventId: ids.live, eventAffiliateId: ids.promoterAffiliate, status: 'refunded', subtotalCents: 90000, totalCents: 90000, affiliateCommissionCents: 9000, idempotencyKey: randomUUID(), paidAt: new Date() },
      { buyerUserId: ids.buyer, eventId: ids.live, eventAffiliateId: ids.promoterAffiliate, status: 'paid', currency: 'EUR', subtotalCents: 90000, totalCents: 90000, affiliateCommissionCents: 9000, idempotencyKey: randomUUID(), paidAt: new Date() },
    ]);
    await m.GuestlistEntry.bulkCreate(['direct', 'employee', 'promoter'].map((role) => ({
      id: ids[`${role}Entry`], eventId: ids.live, eventAffiliateId: role === 'direct' ? null : ids[`${role}Affiliate`],
      guestName: `Guest ${role}`, partySize: 2, source: role === 'direct' ? 'event' : 'affiliate', status: 'pending',
    })));
    await m.GuestlistEntry.create({ id: ids.pastEntry, eventId: ids.past, guestName: 'Past guest', partySize: 1, source: 'event', status: 'pending' });
    server = createApp({ sequelize, models: m, config }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    for (const role of roles) {
      const issuedAt = Math.floor(Date.now() / 1000);
      const session = await m.AuthSession.create({ userId: ids[role], expiresAt: new Date((issuedAt + 600) * 1000) });
      tokens.set(role, signToken({ sub: ids[role], sid: session.id, iat: issuedAt, exp: issuedAt + 600, pwd: null }, config.AUTH_TOKEN_SECRET));
    }
    const request = (path, role = 'owner', options = {}) => httpRequest(server, `/api${path}`, { ...options, token: tokens.get(role) });
    const my = (suffix = '') => `/customer/my-events${suffix}`;
    const checkWire = (path, response, method = 'get') => {
      const contract = contracts.find((candidate) => candidate.path === path && candidate.method === method);
      const checked = contract.responseSchemas[response.status]?.safeParse(response.body);
      assert.equal(checked?.success, true, JSON.stringify(checked?.error || response.body));
    };
    // A domain call makes SQL failures inspectable without weakening the
    // redacted HTTP error boundary used by the remaining session regressions.
    const domain = require('../src/services/customer-my-events-service').createCustomerMyEventsService({ models: m,
      businessRead: require('../src/services/business-read-service').createBusinessReadService({ models: m, internalReadPermission: 'events.manage' }),
      businessEventRead: require('../src/services/business-event-read-service').createBusinessEventReadService({ models: m }) });
    await domain.detail(ids.owner, ids.live);

    await t.test('customer sessions expose eligibility only after active accepted business access', async () => {
      assert.equal((await request(my('/access'), null)).status, 401);
      for (const role of roles.filter((role) => !['ordinary', 'pending', 'buyer'].includes(role))) {
        const access = await request(my('/access'), role);
        assert.deepEqual(access.body.data, { eligible: true });
        assert.equal(access.headers['cache-control'], 'no-store');
        checkWire('/customer/my-events/access', access);
      }
      for (const role of ['ordinary', 'pending', 'buyer']) {
        const response = await request(my('/access'), role);
        if (role === 'pending') assert.equal(response.status, 401, 'unfinished onboarding cannot authenticate an operational session');
        else assert.deepEqual(response.body.data, { eligible: false });
        const denied = await request(my(), role);
        assert.equal(denied.status, role === 'pending' ? 401 : 403);
        if (role !== 'pending') assert.equal(denied.body.error.code, 'BUSINESS_ACCESS_REQUIRED');
        assert.equal((await request(my(`/${ids.live}`), role)).status, role === 'pending' ? 401 : 403);
      }
    });

    await t.test('upcoming includes ongoing; pagination, search, organization and exact venue scope stay bounded', async () => {
      const first = await request(my('?status=upcoming&pageSize=1&sort=starts_asc'));
      const second = await request(my('?status=upcoming&pageSize=1&page=2&sort=starts_asc'));
      assert.equal(first.body.data.total, 2);
      assert.deepEqual(first.body.data.items.map((event) => event.id), [ids.live]);
      assert.deepEqual(second.body.data.items.map((event) => event.id), [ids.upcoming]);
      assert.equal(first.body.data.hasMore, true);
      assert.equal(first.body.data.counts.past, 2);
      assert.equal(first.body.data.counts.draft, 1);
      checkWire('/customer/my-events', first);
      assert.deepEqual((await request(my('?status=upcoming&search=Other%20Room'))).body.data.items.map((event) => event.id), [ids.upcoming]);
      assert.equal((await request(my(`?organizationId=${randomUUID()}`))).body.data.total, 0);
      const bootstrap = await request('/business/bootstrap');
      const venueId = bootstrap.body.data.venues.find((venue) => venue.locationIds.includes(ids.otherLocation)).id;
      assert.deepEqual((await request(my(`?status=upcoming&venueIds=${venueId}`))).body.data.items.map((event) => event.id), [ids.upcoming]);
      for (const role of ['manager', 'employee', 'orgPromoter']) assert.equal((await request(my('?status=upcoming'), role)).body.data.total, 2);
      for (const role of ['venueManager', 'venueEmployee', 'venuePromoter', 'promoter']) {
        assert.deepEqual((await request(my('?status=upcoming'), role)).body.data.items.map((event) => event.id), [ids.live]);
        assert.equal((await request(my(`/${ids.upcoming}`), role)).status, 404, 'an event at another venue stays inaccessible');
      }
      const businessList = await request('/business/events?status=upcoming', 'venuePromoter');
      assert.equal(businessList.body.data.items[0].canReviewGuestlist, true, 'shared read capability recognizes the exact active venue-linked assignment');
    });

    await t.test('internal report-only staff retain real memberships without Customer-wide event reporting access', async () => {
      const empty = await request(my('?status=upcoming'), 'readOnlyUnassigned');
      assert.equal(empty.status, 200);
      assert.equal(empty.body.data.total, 0);
      assert.deepEqual(empty.body.data.items, []);
      assert.equal((await request(my(`/${ids.live}`), 'readOnlyUnassigned')).status, 404);
      assert.equal((await request(my(`/${ids.live}/guestlist-page`), 'readOnlyUnassigned')).status, 404);
      const business = await request('/business/events?status=upcoming', 'readOnlyUnassigned');
      assert.ok(business.body.data.total > 0, 'existing Business reports.view collection behavior is unchanged');
      assert.equal(business.body.data.items.find((event) => event.id === ids.live).lifetimeSales.salesCents, 12000);
      await m.EventAffiliate.update({ userId: ids.readOnlyMember }, { where: { id: ids.employeeAffiliate } });
      try {
        const page = await request(my('?status=upcoming'), 'readOnlyMember');
        const detail = await request(my(`/${ids.live}`), 'readOnlyMember');
        assert.equal(page.body.data.total, 2, 'actual organization employment still grants both organization events');
        const listed = page.body.data.items.find((event) => event.id === ids.live);
        assert.equal(listed.scope, 'own');
        assert.equal(listed.lifetimeSales.salesCents, 4000);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.scope, listed.scope);
        assert.equal(detail.body.data.summary.salesCents, listed.lifetimeSales.salesCents);
        assert.equal(detail.body.data.personalEarnings.earnedCommissionCents, 400);
        assert.equal(detail.body.data.capabilities.canInviteGuestlist, true);
        const guests = await request(my(`/${ids.live}/guestlist-page`), 'readOnlyMember');
        assert.deepEqual(guests.body.data.items.map((entry) => entry.id), [ids.employeeEntry]);
        assert.equal((await request(my(`/${ids.live}/guestlist-page/${ids.directEntry}`), 'readOnlyMember')).status, 404);
        assert.deepEqual((await request(my(`/${ids.live}/guestlist-invite-pools`), 'readOnlyMember')).body.data,
          { direct: false, open: true, own: [{ id: ids.employeeAffiliate, guestlistAllocation: 10 }] });
      } finally {
        await m.EventAffiliate.update({ userId: ids.employee }, { where: { id: ids.employeeAffiliate } });
      }
    });

    await t.test('internal event operations may review but unassigned staff have no usable invitation pool', async () => {
      const page = await request(my('?status=upcoming'), 'operations');
      const listed = page.body.data.items.find((event) => event.id === ids.live);
      const detail = await request(my(`/${ids.live}`), 'operations');
      assert.equal(detail.status, 200);
      assert.equal(listed.scope, 'event');
      assert.equal(detail.body.data.scope, listed.scope);
      assert.equal(detail.body.data.summary.salesCents, listed.lifetimeSales.salesCents);
      assert.deepEqual(detail.body.data.capabilities, { readOnly: false, canShareReferral: false,
        canReviewGuestlist: true, canInviteGuestlist: false });
      assert.equal(listed.capabilities.canInviteGuestlist, false);
      assert.deepEqual((await request(my(`/${ids.live}/guestlist-invite-pools`), 'operations')).body.data,
        { direct: false, open: true, own: [] });
      const before = await m.GuestlistInvitation.count();
      const blocked = await request(my(`/${ids.live}/guestlist-invitations`), 'operations',
        { method: 'POST', body: { pool: 'direct', inviteBy: 'personal', name: 'Unusable operations invite', partySize: 1 } });
      assert.equal(blocked.status, 403);
      assert.equal(await m.GuestlistInvitation.count(), before);
      assert.equal((await request(`/business/events/${ids.live}/guestlist-invite-pools`, 'operations')).body.data.direct,
        true, 'shared Business pool response is deliberately unchanged');
    });

    await t.test('event-wide totals differ from personal earnings and ordinary staff see only credited statistics and guests', async () => {
      for (const [role, scope, sales, earned] of [['owner', 'event', 12000, 200], ['manager', 'event', 12000, 0], ['employee', 'own', 4000, 400], ['promoter', 'own', 6000, 600], ['orgPromoter', 'own', 0, 0], ['venueManager', 'event', 12000, 0], ['venueEmployee', 'own', 0, 0]]) {
        const response = await request(my(`/${ids.live}`), role), data = response.body.data;
        assert.equal(response.status, 200, JSON.stringify(response.body));
        checkWire('/customer/my-events/:eventId', response);
        assert.equal(data.scope, scope);
        assert.equal(data.summary.salesCents, sales);
        assert.equal(data.personalEarnings.earnedCommissionCents, earned);
        assert.equal(data.personalEarnings.receivedPayouts, null);
        assert.equal(data.personalEarnings.payoutsTracked, false);
        assert.equal(data.capabilities.readOnly, false);
        assert.equal(data.capabilities.canShareReferral, true);
        assert.equal(data.capabilities.canReviewGuestlist, role !== 'orgPromoter', 'organization promoters gain own review only after selecting an event allocation');
        assert.equal('paymentAccountId' in data.event, false);
        assert.equal('defaultPaymentAccountId' in data.event.organization, false);
        assert.equal('canEdit' in data.event, false);
        assert.equal('canManageFinance' in data.event, false);
        assert.equal('accessCodeHash' in data.event.offerings[0], false);
        if (scope === 'own') assert.equal('quantitySold' in data.event.offerings[0], false);
      }
      assert.equal((await request(my(`/${ids.live}`), 'owner')).body.data.summary.commissionCents, 1200);
      assert.equal((await request(my(`/${ids.live}`), 'owner')).body.data.personalEarnings.demoCommissionCents, 200);
      assert.equal((await request(my(`/${ids.live}`), 'employee')).body.data.personalEarnings.unverifiedCommissionCents, 400);
      const ownerGuests = await request(my(`/${ids.live}/guestlist-page`));
      checkWire('/customer/my-events/:eventId/guestlist-page', ownerGuests);
      assert.equal(ownerGuests.body.data.total, 3);
      for (const role of ['employee', 'promoter']) {
        const ownGuests = await request(my(`/${ids.live}/guestlist-page`), role);
        assert.deepEqual(ownGuests.body.data.items.map((entry) => entry.id), [ids[`${role}Entry`]]);
        assert.equal((await request(my(`/${ids.live}/guestlist-page/${ids.directEntry}`), role)).status, 404);
      }
      const ownRow = await request(my(`/${ids.live}/guestlist-page/${ids.promoterEntry}`), 'promoter');
      checkWire('/customer/my-events/:eventId/guestlist-page/:entryId', ownRow);
      assert.equal('qrTokenHash' in ownRow.body.data, false);
    });

    let invitationEntry;
    await t.test('live actions use existing referral, pools, capacity and entry-review authority', async () => {
      const link = await request(my(`/${ids.live}/referral-link`), 'employee');
      assert.equal(link.status, 200, JSON.stringify(link.body));
      checkWire('/customer/my-events/:eventId/referral-link', link);
      assert.equal(link.body.data.eventId, ids.live);
      const orgLink = await request(my(`/${ids.live}/referral-link`), 'orgPromoter');
      assert.equal(orgLink.status, 200, JSON.stringify(orgLink.body));
      assert.equal((await request(my(`/${ids.live}`), 'orgPromoter')).body.data.capabilities.canInviteGuestlist, true, 'stable event referral assignment adopts the organization allocation');
      const pools = await request(my(`/${ids.live}/guestlist-invite-pools`), 'promoter');
      checkWire('/customer/my-events/:eventId/guestlist-invite-pools', pools);
      assert.deepEqual(pools.body.data, { direct: false, open: true, own: [{ id: ids.promoterAffiliate, guestlistAllocation: 10 }] });
      const inviteBody = { inviteBy: 'personal', name: 'Invited offline guest', partySize: 2, pool: 'own', eventAffiliateId: ids.promoterAffiliate };
      assert.equal((await request(my(`/${ids.live}/guestlist-invitations`), 'promoter', { method: 'POST', body: { ...inviteBody, pool: 'direct', eventAffiliateId: undefined } })).status, 403);
      assert.equal((await request(my(`/${ids.live}/guestlist-invitations`), 'employee', { method: 'POST', body: inviteBody })).status, 403);
      const invited = await request(my(`/${ids.live}/guestlist-invitations`), 'promoter', { method: 'POST', body: inviteBody });
      assert.equal(invited.status, 201, JSON.stringify(invited.body));
      checkWire('/customer/my-events/:eventId/guestlist-invitations', invited, 'post');
      invitationEntry = invited.body.data.entryId;
      const invitationLink = await request(my(`/${ids.live}/guestlist/${invitationEntry}/invitation-link`), 'promoter');
      checkWire('/customer/my-events/:eventId/guestlist/:entryId/invitation-link', invitationLink);
      assert.equal(invitationLink.body.data.token, invited.body.data.token);
      assert.equal((await request(my(`/${ids.live}/guestlist/${invitationEntry}/invitation-link`), 'employee')).status, 404);
      assert.equal((await request(my(`/${ids.live}/guestlist/${ids.directEntry}/decision`), 'promoter', { method: 'POST', body: { decision: 'approve' } })).status, 403);
      const reviewed = await request(my(`/${ids.live}/guestlist/${ids.promoterEntry}/decision`), 'promoter', { method: 'POST', body: { decision: 'approve' } });
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
      checkWire('/customer/my-events/:eventId/guestlist/:entryId/decision', reviewed, 'post');
      assert.equal(reviewed.body.data.entry.status, 'confirmed');
      assert.equal('qrTokenHash' in reviewed.body.data.entry, false);
      assert.equal((await request(my(`/${ids.live}/guestlist-capacity`), 'owner', { method: 'PATCH', body: { capacity: 100 } })).status, 404);
      assert.equal((await request(my(`/${ids.live}`), 'owner', { method: 'PUT', body: {} })).status, 405);
    });

    await t.test('past/completed/draft events have no share, invitations or review but retain scoped history', async () => {
      for (const kind of ['past', 'completed', 'draft']) {
        const response = await request(my(`/${ids[kind]}`));
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.deepEqual(response.body.data.capabilities, { readOnly: true, canShareReferral: false, canInviteGuestlist: false, canReviewGuestlist: false });
        const pools = await request(my(`/${ids[kind]}/guestlist-invite-pools`));
        assert.deepEqual(pools.body.data, { direct: false, own: [], open: false });
        assert.equal((await request(my(`/${ids[kind]}/referral-link`))).status, 409);
        const invite = await request(my(`/${ids[kind]}/guestlist-invitations`), 'owner', { method: 'POST', body: { pool: 'direct', inviteBy: 'personal', name: 'Blocked invite', partySize: 1 } });
        assert.equal(invite.status, 409);
      }
      const review = await request(my(`/${ids.past}/guestlist/${ids.pastEntry}/decision`), 'owner', { method: 'POST', body: { decision: 'approve' } });
      assert.equal(review.status, 409);
      assert.equal(review.body.error.code, 'EVENT_FINISHED');
      assert.equal((await m.GuestlistEntry.findByPk(ids.pastEntry)).status, 'pending');
      assert.equal((await request(my(`/${ids.past}/guestlist-page`))).body.data.total, 1);
    });

    await t.test('referral capabilities follow inactive, future and expired linked organization affiliation', async () => {
      const linked = await m.OrgAffiliate.create({ organizationId: ids.org, userId: ids.owner, code: `LINKED-${randomUUID()}`,
        defaultCommissionBps: 0, defaultGuestlistAllocation: 0 });
      await m.EventAffiliate.update({ orgAffiliateId: linked.id }, { where: { id: ids.ownerAffiliate } });
      try {
        for (const change of [
          { status: 'inactive', startsAt: null, endsAt: null },
          { status: 'active', startsAt: new Date(Date.now() + 3600000), endsAt: null },
          { status: 'active', startsAt: null, endsAt: new Date(Date.now() - 3600000) },
        ]) {
          await linked.update(change);
          const detail = await request(my(`/${ids.live}`));
          assert.equal(detail.status, 200);
          assert.equal(detail.body.data.capabilities.canShareReferral, false);
          assert.equal(detail.body.data.capabilities.canReviewGuestlist, true, 'separate owner review authority remains available');
          const rejectedLink = await request(my(`/${ids.live}/referral-link`));
          assert.equal(rejectedLink.body.error.code, 'INVALID_AFFILIATE', 'the existing domain remains authoritative');
        }
        await linked.update({ status: 'active', startsAt: null, endsAt: null });
        assert.equal((await request(my(`/${ids.live}`))).body.data.capabilities.canShareReferral, true);
      } finally {
        await m.EventAffiliate.update({ orgAffiliateId: null }, { where: { id: ids.ownerAffiliate } });
        await linked.destroy();
      }
    });

    await t.test('stale venue-bound assignments offer no referral or own invitation after an event moves venues', async () => {
      const membership = await m.OrganizationEmployee.create({ organizationId: ids.org, userId: ids.venueEmployee });
      await m.Event.update({ locationId: ids.otherLocation }, { where: { id: ids.live } });
      try {
        const detail = await request(my(`/${ids.live}`), 'venueEmployee');
        assert.equal(detail.status, 200, 'separate organization membership retains read access');
        assert.deepEqual(detail.body.data.capabilities, { readOnly: false, canShareReferral: false,
          canReviewGuestlist: false, canInviteGuestlist: false });
        const page = await request(my('?status=upcoming'), 'venueEmployee');
        assert.equal(page.body.data.items.find((event) => event.id === ids.live).capabilities.canShareReferral, false);
        const link = await request(my(`/${ids.live}/referral-link`), 'venueEmployee');
        assert.equal(link.status, 403, 'authoritative exact-grant denial remains unchanged');
        assert.equal((await request(my(`/${ids.live}/guestlist-invite-pools`), 'venueEmployee')).status, 403);
      } finally {
        await m.Event.update({ locationId: ids.location }, { where: { id: ids.live } });
        await membership.destroy();
      }
    });

    await t.test('own invitation hints and pools reject invalid linked affiliation despite an explicit allocation', async () => {
      const linked = await m.OrgAffiliate.create({ organizationId: ids.org, userId: ids.promoter, code: `INVITE-LINK-${randomUUID()}`,
        defaultCommissionBps: 1000, defaultGuestlistAllocation: 10 });
      await m.EventAffiliate.update({ orgAffiliateId: linked.id }, { where: { id: ids.promoterAffiliate } });
      try {
        for (const change of [
          { status: 'inactive', startsAt: null, endsAt: null },
          { status: 'active', startsAt: new Date(Date.now() + 3600000), endsAt: null },
          { status: 'active', startsAt: null, endsAt: new Date(Date.now() - 3600000) },
        ]) {
          await linked.update(change);
          const detail = await request(my(`/${ids.live}`), 'promoter');
          assert.equal(detail.status, 200, 'independent event scope remains readable');
          assert.equal(detail.body.data.capabilities.canInviteGuestlist, false);
          assert.equal(detail.body.data.capabilities.canShareReferral, false);
          assert.equal(detail.body.data.capabilities.canReviewGuestlist, true, 'current Business own-review permission is preserved');
          assert.deepEqual((await request(my(`/${ids.live}/guestlist-invite-pools`), 'promoter')).body.data,
            { direct: false, open: true, own: [] });
        }
        await linked.update({ status: 'active', startsAt: null, endsAt: null });
        assert.equal((await request(my(`/${ids.live}`), 'promoter')).body.data.capabilities.canInviteGuestlist, true);
        assert.equal((await request(my(`/${ids.live}/guestlist-invite-pools`), 'promoter')).body.data.own.length, 1);
      } finally {
        await m.EventAffiliate.update({ orgAffiliateId: null }, { where: { id: ids.promoterAffiliate } });
        await linked.destroy();
      }
    });

    await t.test('lifecycle changes committed while actions wait close every operation without side effects', async () => {
      const entered = gate(), release = gate();
      const closing = mutationTransaction(sequelize, async (transaction) => {
        await m.Event.update({ status: 'completed' }, { where: { id: ids.live }, transaction }); entered.resolve(); await release.promise;
      }, { accessChange: true });
      await entered.promise;
      const before = [await m.GuestlistInvitation.count(), await m.AuditLog.count(), await m.Notification.count()];
      const actions = [
        request(my(`/${ids.live}/guestlist/${ids.employeeEntry}/decision`), 'owner', { method: 'POST', body: { decision: 'approve' } }),
        request(my(`/${ids.live}/guestlist-invitations`), 'owner', { method: 'POST', body: { pool: 'direct', inviteBy: 'personal', name: 'Race blocked', partySize: 1 } }),
        request(my(`/${ids.live}/referral-link`)),
        request(my(`/${ids.live}/guestlist/${invitationEntry}/invitation-link`)),
      ].map((action) => Promise.resolve(action));
      try { await waitForFenceWaiter(sequelize); } finally { release.resolve(); }
      await closing;
      for (const result of await Promise.all(actions)) assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.deepEqual([await m.GuestlistInvitation.count(), await m.AuditLog.count(), await m.Notification.count()], before);
      assert.equal((await m.GuestlistEntry.findByPk(ids.employeeEntry)).status, 'pending');
      await m.Event.update({ status: 'published' }, { where: { id: ids.live } });
    });

    await t.test('same signed-in customer loses access when venue/event/team grants or lifecycle are revoked', async () => {
      await mutationTransaction(sequelize, (transaction) => m.VenueAccess.update({ status: 'inactive' }, { where: { id: ids.venuePromoterGrant }, transaction }), { accessChange: true });
      assert.deepEqual((await request(my('/access'), 'venuePromoter')).body.data, { eligible: false });
      assert.equal((await request(my(`/${ids.live}`), 'venuePromoter')).status, 403);
      await mutationTransaction(sequelize, (transaction) => m.EventAffiliate.update({ status: 'inactive' }, { where: { id: ids.promoterAffiliate }, transaction }), { accessChange: true });
      assert.deepEqual((await request(my('/access'), 'promoter')).body.data, { eligible: false });
      assert.equal((await request(my(`/${ids.live}/guestlist-page`), 'promoter')).status, 403);
      assert.equal((await request(my(`/${ids.live}/guestlist/${invitationEntry}/decision`), 'promoter', { method: 'POST', body: { decision: 'cancel' } })).status, 403);
      const entered = gate(), release = gate();
      const removing = mutationTransaction(sequelize, async (transaction) => {
        await m.OrganizationOwner.update({ lifecycleState: 'archived' }, { where: { userId: ids.manager, organizationId: ids.org }, transaction }); entered.resolve(); await release.promise;
      }, { accessChange: true });
      await entered.promise;
      const review = Promise.resolve(request(my(`/${ids.live}/guestlist/${ids.employeeEntry}/decision`), 'manager', { method: 'POST', body: { decision: 'approve' } }));
      try { await waitForFenceWaiter(sequelize); } finally { release.resolve(); }
      await removing;
      const denied = await review;
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, 'BUSINESS_ACCESS_REQUIRED');
      assert.equal((await m.GuestlistEntry.findByPk(ids.employeeEntry)).status, 'pending');
      await mutationTransaction(sequelize, (transaction) => m.Organization.update({ lifecycleState: 'suspended', status: 'suspended' }, { where: { id: ids.org }, transaction }), { accessChange: true });
      assert.deepEqual((await request(my('/access'))).body.data, { eligible: false });
      assert.equal((await request(my(`/${ids.live}`))).status, 403);
      const permissions = require('../src/services/permission-service').createPermissionService(m);
      await permissions.assertBusinessAccess(ids.owner); // Existing suspended-merchant admission gate remains intact.
      await permissions.assertAdmitEvent(ids.owner, ids.live);
      await m.Organization.update({ lifecycleState: 'active', status: 'active' }, { where: { id: ids.org } });
      await m.Location.update({ lifecycleState: 'suspended' }, { where: { id: ids.location } });
      assert.equal((await request(my(`/${ids.live}`))).status, 404);
      assert.equal((await request(my(`/${ids.live}/guestlist-invitations`), 'owner', { method: 'POST', body: { pool: 'direct', inviteBy: 'personal', name: 'Blocked', partySize: 1 } })).status, 403);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await sequelize.close(); // The test runner drops only its generated database.
  }
});
