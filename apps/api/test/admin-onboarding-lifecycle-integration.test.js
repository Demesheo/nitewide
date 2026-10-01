const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('./support/http-client.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { signToken, createPasswordRecord } = require('../src/services/auth-service');
const { aggregateAdminSales } = require('../src/services/admin-service');

test('admin onboarding, scoped edits, and lifecycle transitions preserve authorization and history', async () => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const config = getConfig();
  assert.equal(config.NODE_ENV, 'test');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname));
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  const emailMessages = [];
  const email = {
    enabled: true,
    queue: async (message, transaction) => { emailMessages.push({ message, transaction }); return true; },
  };
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitewide-admin-lifecycle-'));
  const ids = {
    admin: crypto.randomUUID(), manager: crypto.randomUUID(), buyer: crypto.randomUUID(), existing: crypto.randomUUID(),
    org: null, locationA: null, locationB: null, foreignOrg: null, foreignLocation: null,
    event: null, draftEvent: null, offering: null, order: null, orderItem: null, ticket: null, guest: null,
  };
  let server;

  try {
    await sequelize.authenticate();
    const changedAt = new Date('2026-09-01T12:00:00.000Z');
    const sharedCredential = await createPasswordRecord('ExistingPassword123');
    await models.User.bulkCreate([
      { id: ids.admin, email: `${ids.admin}@integration.nitewide.test`, displayName: 'Fixture Internal Admin', isActive: true, isInternalAdmin: true, lifecycleState: 'active', onboardingPending: false },
      { id: ids.manager, email: `${ids.manager}@integration.nitewide.test`, displayName: 'Fixture Venue Manager', isActive: true, lifecycleState: 'active', onboardingPending: false },
      { id: ids.buyer, email: `${ids.buyer}@integration.nitewide.test`, displayName: 'Fixture Buyer', isActive: true, lifecycleState: 'active', onboardingPending: false },
      { id: ids.existing, email: `${ids.existing}@integration.nitewide.test`, displayName: 'Fixture Existing Account', isActive: true, lifecycleState: 'active', onboardingPending: false, emailVerifiedAt: changedAt },
    ]);
    await models.UserCredential.create({ userId: ids.admin, ...await createPasswordRecord('InternalAdmin123'), passwordChangedAt: changedAt });
    await models.UserCredential.create({ userId: ids.manager, ...await createPasswordRecord('VenueManager123'), passwordChangedAt: changedAt });
    await models.UserCredential.create({ userId: ids.buyer, ...await createPasswordRecord('FixtureBuyer123'), passwordChangedAt: changedAt });
    await models.UserCredential.create({ userId: ids.existing, ...sharedCredential, passwordChangedAt: changedAt });

    const app = createApp({
      sequelize, models,
      config: { ...config, NODE_ENV: 'production', hostedDemo: true, MEDIA_UPLOAD_DIR: mediaDir }, // Production authentication with explicit simulated paid-event fixtures.
      services: { email },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function tokenFor(userId) {
      const credential = await models.UserCredential.findByPk(userId);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const session = await models.AuthSession.create({ userId, expiresAt: new Date((nowSeconds + 600) * 1000) });
      return signToken({ sub: userId, sid: session.id, iat: nowSeconds, exp: nowSeconds + 600, pwd: credential?.passwordChangedAt ? new Date(credential.passwordChangedAt).getTime() : null }, config.AUTH_TOKEN_SECRET);
    }
    async function request(route, userId = null, method = 'GET', body) {
      const token = userId ? await tokenFor(userId) : null;
      return httpRequest(server, `/api${route}`, { method, token, body });
    }

    assert.equal((await request('/admin/onboarding', null, 'POST', {})).status, 401);
    assert.equal((await request('/admin/onboarding', ids.manager, 'POST', {})).status, 403);
    assert.equal((await request('/admin/management/users/not-a-uuid', ids.buyer, 'PATCH', {})).status, 403);

    const orgInvite = await request('/admin/onboarding', ids.admin, 'POST', {
      kind: 'organization',
      confirmedAuthority: true,
      recipient: { email: 'fixture-owner@example.test', displayName: 'Fixture Owner' },
      organization: { name: 'Fixture Multi Venue Org', slug: `fixture-${crypto.randomUUID()}`, planTier: 'free' },
      venues: [
        { name: 'Venue A', addressLine1: '1 Test Way', city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
        { name: 'Venue B', addressLine1: '2 Test Way', city: 'Tampa', region: 'FL', postalCode: '33602', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
      ],
      reason: 'Create an isolated multi-venue fixture',
    });
    assert.equal(orgInvite.status, 201, JSON.stringify(orgInvite.body));
    assert.equal(orgInvite.body.data.accountMode, 'new');
    assert.equal(orgInvite.body.data.delivery, 'queued');
    assert.equal('token' in orgInvite.body.data, false);
    assert.equal('handoff' in orgInvite.body.data, false);
    const orgSetupUrl = emailMessages.find(({ message }) => message.template === 'nitewide-account-setup' && message.to === 'fixture-owner@example.test')?.message.variables.SETUP_URL;
    assert.ok(orgSetupUrl);
    const orgToken = new URL(orgSetupUrl).searchParams.get('onboarding');
    const orgInvitation = await models.OnboardingInvitation.findByPk(orgInvite.body.data.id);
    assert.equal(orgInvitation.tokenHash, crypto.createHash('sha256').update(orgToken).digest('hex'));
    assert.equal(JSON.stringify(orgInvitation.toJSON()).includes(orgToken), false);
    assert.equal(JSON.stringify(await models.AuditLog.findAll({ where: { entityType: 'OnboardingInvitation', entityId: orgInvitation.id } })).includes(orgToken), false);

    const preview = await request(`/auth/onboarding/preview?token=${encodeURIComponent(orgToken)}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.accountMode, 'new');
    assert.equal(preview.body.data.email, 'fixture-owner@example.test');
    assert.equal((await models.OnboardingInvitation.findByPk(orgInvitation.id)).acceptedAt, null);
    assert.equal('token' in preview.body.data, false);

    const sentBeforeUnavailable = emailMessages.length;
    email.enabled = false;
    const unavailableInvite = await request('/admin/onboarding', ids.admin, 'POST', {
      kind: 'user', recipient: { email: 'delivery-unavailable@example.test', displayName: 'Delivery Unavailable' }, reason: 'Keep onboarding recoverable when email is disabled',
    });
    email.enabled = true;
    assert.equal(unavailableInvite.status, 201, JSON.stringify(unavailableInvite.body));
    assert.equal(unavailableInvite.body.data.delivery, 'unavailable');
    assert.equal(emailMessages.length, sentBeforeUnavailable, 'disabled delivery does not call the mail queue');
    assert.ok(await models.OnboardingInvitation.findByPk(unavailableInvite.body.data.id), 'unavailable setup remains recoverable for resend');

    const mismatch = await request('/auth/onboarding/accept', null, 'POST', { token: orgToken, password: 'FixturePassword123', confirmPassword: 'OtherPassword123' });
    assert.equal(mismatch.status, 422);
    const concurrentAccept = await Promise.all([
      request('/auth/onboarding/accept', null, 'POST', { token: orgToken, password: 'FixturePassword123', confirmPassword: 'FixturePassword123' }),
      request('/auth/onboarding/accept', null, 'POST', { token: orgToken, password: 'FixturePassword123', confirmPassword: 'FixturePassword123' }),
    ]);
    assert.equal(concurrentAccept.filter((result) => result.status === 200).length, 1, JSON.stringify(concurrentAccept));
    assert.equal(concurrentAccept.filter((result) => result.status === 409).length, 1, JSON.stringify(concurrentAccept));
    const owner = await models.User.findByPk(orgInvite.body.data.userId);
    ids.org = orgInvitation.grants.organizationId;
    assert.equal(owner.onboardingPending, false);
    assert.ok(owner.emailVerifiedAt);
    assert.ok(await models.UserCredential.findByPk(owner.id));
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: ids.org, userId: owner.id, role: 'owner' } }), 1);
    const organization = await models.Organization.findByPk(ids.org);
    const organizationLinks = await models.OrganizationVenue.findAll({ where: { organizationId: ids.org } });
    assert.equal(organizationLinks.length, 2);
    ids.locationA = organization.locationId;
    ids.locationB = organizationLinks.find((link) => link.locationId !== ids.locationA).locationId;
    const creatorInvite = await request('/admin/onboarding', ids.admin, 'POST', {
      kind: 'independent_creator', confirmedAuthority: true, recipient: { email: 'independent-creator@example.test', displayName: 'Independent Creator' }, organization: { name: 'Independent Creator Workspace', slug: `creator-${crypto.randomUUID()}` }, reason: 'Onboard an independent creator',
    });
    assert.equal(creatorInvite.status, 201, JSON.stringify(creatorInvite.body));
    const creatorSetup = emailMessages.find(({ message }) => message.template === 'nitewide-account-setup' && message.to === 'independent-creator@example.test');
    const creatorToken = new URL(creatorSetup.message.variables.SETUP_URL).searchParams.get('onboarding');
    const creatorAccept = await request('/auth/onboarding/accept', null, 'POST', { token: creatorToken, password: 'IndependentCreator123', confirmPassword: 'IndependentCreator123' });
    assert.equal(creatorAccept.status, 200, JSON.stringify(creatorAccept.body));
    const independentCreator = await models.User.findByPk(creatorAccept.body.data.userId);
    assert.equal(independentCreator.independentCreator, false);
    assert.ok(creatorInvite.body.data.organizationId);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: creatorInvite.body.data.organizationId, userId: independentCreator.id, role: 'owner' } }), 1);
    assert.equal(await models.Event.count({ where: { creatorUserId: independentCreator.id } }), 0, 'onboarding creates creator access without seeding any events');
    const soleOwnerDemotion = await request(`/admin/management/users/${owner.id}/scoped-role`, ids.admin, 'POST', {
      organizationId: ids.org, role: 'employee', reason: 'Reject demotion of the only active owner', version: owner.version,
    });
    assert.equal(soleOwnerDemotion.status, 409);
    assert.equal(soleOwnerDemotion.body.error.code, 'LAST_ORGANIZATION_OWNER');
    await models.OrganizationOwner.create({ organizationId: ids.org, userId: ids.manager, role: 'owner' });
    await models.User.update({ lifecycleState: 'suspended' }, { where: { id: ids.manager } });
    const inactiveCoOwnerDemotion = await request(`/admin/management/users/${owner.id}/scoped-role`, ids.admin, 'POST', {
      organizationId: ids.org, role: 'employee', reason: 'Reject demotion when the other owner is inactive', version: owner.version,
    });
    assert.equal(inactiveCoOwnerDemotion.status, 409);
    assert.equal(inactiveCoOwnerDemotion.body.error.code, 'LAST_ORGANIZATION_OWNER');
    await models.User.update({ lifecycleState: 'active' }, { where: { id: ids.manager } });

    const orgList = await request(`/admin/management/organizations?pageSize=100`, ids.admin);
    assert.equal(orgList.status, 200);
    assert.ok(orgList.body.data.items.some((row) => row.id === ids.org));
    const orgBefore = orgList.body.data.items.find((row) => row.id === ids.org);
    const venueList = await request('/admin/management/locations?pageSize=100', ids.admin);
    assert.equal(venueList.status, 200, JSON.stringify(venueList.body));
    assert.ok(venueList.body.data.items.some((row) => row.id === ids.locationA));
    assert.ok(venueList.body.data.items.some((row) => row.id === ids.locationB));
    const retiredBusinessType = await request(`/admin/management/organizations/${ids.org}`, ids.admin, 'PATCH', { businessType: 'venue', reason: 'Legacy classification is no longer editable', version: orgBefore.version });
    assert.equal(retiredBusinessType.status, 422);
    const retiredBulkVenues = await request(`/admin/management/organizations/${ids.org}`, ids.admin, 'PATCH', { venueIds: [ids.locationA, ids.locationB], reason: 'Manage venues individually instead', version: orgBefore.version });
    assert.equal(retiredBulkVenues.status, 409);
    assert.equal(retiredBulkVenues.body.error.code, 'VENUE_MANAGEMENT_REQUIRED');
    const organizationEdit = await request(`/admin/management/organizations/${ids.org}`, ids.admin, 'PATCH', { name: 'Fixture Multi Venue Org Reviewed', reason: 'Confirm reviewed business profile', version: orgBefore.version });
    assert.equal(organizationEdit.status, 200, JSON.stringify(organizationEdit.body));
    const staleOrgEdit = await request(`/admin/management/organizations/${ids.org}`, ids.admin, 'PATCH', { name: 'Stale name', reason: 'Reject stale update', version: orgBefore.version });
    assert.equal(staleOrgEdit.status, 409);
    assert.equal(staleOrgEdit.body.error.code, 'STALE_VERSION');
    const extraOrgField = await request(`/admin/management/organizations/${ids.org}`, ids.admin, 'PATCH', { slug: 'valid-slug', passwordHash: 'must-not-write', reason: 'Reject unknown field', version: organizationEdit.body.data.version });
    assert.equal(extraOrgField.status, 422);

    const foreignLocation = await models.Location.create({ name: 'Foreign Venue', addressLine1: '9 External Road', city: 'Miami', region: 'FL', postalCode: '33101', countryCode: 'US', timezone: 'America/New_York', privacy: 'private', lifecycleState: 'active' });
    ids.foreignLocation = foreignLocation.id;
    const foreignOrg = await models.Organization.create({ name: 'Other Org', slug: `other-${crypto.randomUUID()}`, locationId: foreignLocation.id, status: 'active', lifecycleState: 'active', businessType: 'venue' });
    ids.foreignOrg = foreignOrg.id;
    assert.ok(await models.OrganizationVenue.findOne({ where: { organizationId: ids.foreignOrg, locationId: ids.foreignLocation } }), 'organization creation links its primary venue');
    const event = await models.Event.create({ creatorUserId: owner.id, organizationId: ids.org, locationId: ids.locationA, title: 'Fixture Active Event', slug: `evt-${crypto.randomUUID()}`, category: 'test', status: 'published', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), capacity: 10, guestlistCapacity: 4, isDiscoverable: true, lifecycleState: 'active' });
    ids.event = event.id;
    const leaderAssignment = await models.EventAffiliate.create({ eventId: ids.event, userId: owner.id, code: `LEADEV-${crypto.randomUUID()}`, commissionBps: 0, guestlistAllocation: 0, status: 'active' });
    const offering = await models.Offering.create({ eventId: ids.event, name: 'Fixture ticket', kind: 'ticket', priceCents: 2000, currency: 'USD', inventoryMode: 'finite', quantityTotal: 10, quantitySold: 1, entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 4, visibility: 'public', isActive: true });
    ids.offering = offering.id;
    const order = await models.Order.create({ buyerUserId: ids.buyer, eventId: ids.event, status: 'paid', currency: 'USD', subtotalCents: 2000, platformFeeCents: 0, totalCents: 2000, affiliateCommissionCents: 0, idempotencyKey: `fixture-${crypto.randomUUID()}`, paidAt: new Date(), pricingPlanSnapshot: {} });
    ids.order = order.id;

    const orderItem = await models.OrderItem.create({ orderId: order.id, offeringId: offering.id, nameSnapshot: 'Fixture ticket', kindSnapshot: 'ticket', quantity: 1, entriesPerUnitSnapshot: 1, unitPriceCents: 2000, lineTotalCents: 2000 });
    ids.orderItem = orderItem.id;
    const ticket = await models.Ticket.create({ eventId: ids.event, orderItemId: orderItem.id, holderUserId: ids.buyer, qrTokenHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'), status: 'valid' });
    ids.ticket = ticket.id;
    const guest = await models.GuestlistEntry.create({ eventId: ids.event, userId: ids.buyer, source: 'event', partySize: 2, status: 'confirmed', qrTokenHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'), reviewedByUserId: owner.id, reviewedAt: new Date() });
    ids.guest = guest.id;

    const loadedEditor = await request(`/admin/events/${ids.event}/editor`, ids.admin);
    assert.equal(loadedEditor.status, 200, JSON.stringify(loadedEditor.body));
    const editorEvent = loadedEditor.body.data.event;
    const editorInput = {
      version: editorEvent.version, organizationId: editorEvent.organizationId, locationId: editorEvent.locationId,
      imageAssetId: editorEvent.imageAssetId, title: editorEvent.title, slug: editorEvent.slug,
      summary: editorEvent.summary || '', description: editorEvent.description || '', category: editorEvent.category,
      startsAt: editorEvent.startsAt, endsAt: editorEvent.endsAt, guestlistCapacity: editorEvent.guestlistCapacity,
      capacity: editorEvent.capacity, status: editorEvent.status, isDiscoverable: editorEvent.isDiscoverable,
      offerings: editorEvent.offerings.map((tier) => ({ id: tier.id, name: tier.name, description: tier.description || '', kind: tier.kind,
        priceCents: tier.priceCents, inventoryMode: tier.inventoryMode, quantityTotal: tier.quantityTotal,
        entriesPerUnit: tier.entriesPerUnit, minPerOrder: tier.minPerOrder, maxPerOrder: tier.maxPerOrder,
        isActive: tier.isActive, visibility: tier.visibility, salesStartAt: tier.salesStartAt, salesEndAt: tier.salesEndAt })),
    };
    const badEventVenue = await request(`/admin/events/${ids.event}`, ids.admin, 'PUT', { ...editorInput, locationId: ids.foreignLocation, adminReason: 'Reject a venue from another business' });
    assert.equal(badEventVenue.status, 409);
    assert.equal(badEventVenue.body.error.code, 'VENUE_PARENT_MISMATCH');
    const capacityEdit = await request(`/admin/events/${ids.event}`, ids.admin, 'PUT', { ...editorInput, capacity: 0, adminReason: 'Cannot erase issued admissions' });
    assert.equal(capacityEdit.status, 409);
    const guestCapacityEdit = await request(`/admin/events/${ids.event}`, ids.admin, 'PUT', { ...editorInput, guestlistCapacity: 1, adminReason: 'Cannot erase approved guests' });
    assert.equal(guestCapacityEdit.status, 409);
    const validVenueEdit = await request(`/admin/events/${ids.event}`, ids.admin, 'PUT', { ...editorInput, locationId: ids.locationB, adminReason: 'Move event to linked venue' });
    assert.equal(validVenueEdit.status, 200, JSON.stringify(validVenueEdit.body));
    const venueChangeEmail = emailMessages.find(({ message }) => message.template === 'nitewide-event-venue-change' || message.variables?.OLD_VENUE);
    assert.ok(venueChangeEmail, 'material venue change queues an existing event update notification');

    const existingInvite = await request('/admin/onboarding', ids.admin, 'POST', { kind: 'user', recipient: { email: `${ids.existing}@INTEGRATION.NITEWIDE.TEST`, displayName: 'Existing Account' }, reason: 'Grant existing account access' });
    assert.equal(existingInvite.status, 201, JSON.stringify(existingInvite.body));
    assert.equal(existingInvite.body.data.accountMode, 'existing');
    const existingSetup = emailMessages.find(({ message }) => message.template === 'nitewide-account-setup' && message.to === `${ids.existing}@integration.nitewide.test`);
    const existingToken = new URL(existingSetup.message.variables.SETUP_URL).searchParams.get('onboarding');
    const originalCredential = await models.UserCredential.findByPk(ids.existing);
    const existingUnauthenticated = await request('/auth/onboarding/accept', null, 'POST', { token: existingToken });
    assert.equal(existingUnauthenticated.status, 403);
    const existingAccepted = await request('/auth/onboarding/accept', ids.existing, 'POST', { token: existingToken });
    assert.equal(existingAccepted.status, 200, JSON.stringify(existingAccepted.body));
    assert.equal(existingAccepted.body.data.accountMode, 'existing');
    const afterCredential = await models.UserCredential.findByPk(ids.existing);
    assert.equal(afterCredential.passwordHash, originalCredential.passwordHash);
    assert.equal(afterCredential.passwordSalt, originalCredential.passwordSalt);

    const oldExistingToken = await tokenFor(ids.existing);
    const existingRecord = await models.User.findByPk(ids.existing);
    const changedEmail = `updated-${ids.existing}@integration.nitewide.test`;
    const emailEdit = await request(`/admin/management/users/${ids.existing}`, ids.admin, 'PATCH', { email: changedEmail, confirmEmail: changedEmail, reason: 'Update contact address', version: existingRecord.version });
    assert.equal(emailEdit.status, 200, JSON.stringify(emailEdit.body));
    assert.equal(emailEdit.body.data.emailVerifiedAt, null);
    assert.equal((await request('/auth/me', null, 'GET')).status, 401);
    const staleSessionResponse = await httpRequest(server, '/api/auth/me', { token: oldExistingToken });
    assert.equal(staleSessionResponse.status, 401);
    const updatedCredential = await models.UserCredential.findByPk(ids.existing);
    assert.equal(updatedCredential.passwordHash, originalCredential.passwordHash);
    assert.equal(updatedCredential.passwordSalt, originalCredential.passwordSalt);
    const verifyMail = emailMessages.find(({ message }) => message.to === changedEmail && message.template === 'nitewide-verify-email');
    assert.ok(verifyMail, 'changed email queues verification through the mock outbox');
    const verifyRaw = new URL(verifyMail.message.variables.VERIFY_URL).searchParams.get('verifyEmail');
    const verificationRecord = await models.UserActionToken.findOne({ where: { userId: ids.existing, purpose: 'verify_email' } });
    assert.equal(verificationRecord.tokenHash, crypto.createHash('sha256').update(verifyRaw).digest('hex'));

    const businessDetailBefore = await request(`/business/events/${ids.event}/detail`, owner.id);
    assert.equal(businessDetailBefore.status, 200);
    const orgSuspended = await request(`/admin/management/organizations/${ids.org}/actions/suspend`, ids.admin, 'POST', { reason: 'Pause the fixture business', version: organizationEdit.body.data.version });
    assert.equal(orgSuspended.status, 200, JSON.stringify(orgSuspended.body));
    assert.equal(orgSuspended.body.data.lifecycleState, 'suspended');
    assert.equal(orgSuspended.body.data.status, 'suspended');
    const suspendedSearch = await request(`/admin/management/organizations?status=suspended&search=Fixture%20Multi%20Venue`, ids.admin);
    assert.equal(suspendedSearch.status, 200, JSON.stringify(suspendedSearch.body));
    assert.ok(suspendedSearch.body.data.items.some((item) => item.id === ids.org), 'status and search compose before pagination');
    const activeSearch = await request(`/admin/management/organizations?status=active&search=Fixture%20Multi%20Venue`, ids.admin);
    assert.ok(!activeSearch.body.data.items.some((item) => item.id === ids.org), 'suspended records are not labeled active');
    assert.equal((await request(`/events/${ids.event}`)).status, 404);
    assert.equal((await request(`/business/events/${ids.event}/detail`, owner.id)).status, 403);
    const beforeCheckoutCount = await models.Order.count({ where: { eventId: ids.event } });
    const checkoutWhileSuspended = await request('/orders', ids.buyer, 'POST', { eventId: ids.event, idempotencyKey: `blocked-${crypto.randomUUID()}`, items: [{ offeringId: ids.offering, quantity: 1 }] });
    assert.equal(checkoutWhileSuspended.status, 403);
    assert.equal(await models.Order.count({ where: { eventId: ids.event } }), beforeCheckoutCount);
    assert.equal((await request('/customer/bookings?period=upcoming', ids.buyer)).body.data.orders.some((row) => row.id === ids.order), true, 'past commercial history remains readable to its owner');
    assert.equal(await models.Ticket.count({ where: { id: ids.ticket } }), 1);
    assert.equal(await models.GuestlistEntry.count({ where: { id: ids.guest } }), 1);

    // Exercise the production SQL rollup against the legacy row-by-row fixture
    // aggregator over a large isolated dataset, including org and UTC boundaries.
    const independentEvent = await models.Event.create({ creatorUserId: owner.id, organizationId: null, title: 'Fixture Independent Event', slug: `independent-${crypto.randomUUID()}`, category: 'test', status: 'published', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), guestlistCapacity: 0, isDiscoverable: true, lifecycleState: 'active' });
    const foreignEvent = await models.Event.create({ creatorUserId: owner.id, organizationId: ids.foreignOrg, locationId: ids.foreignLocation, title: 'Fixture Foreign Event', slug: `foreign-${crypto.randomUUID()}`, category: 'test', status: 'published', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), guestlistCapacity: 0, isDiscoverable: true, lifecycleState: 'active' });
    const salesEvents = [
      { id: ids.event, title: event.title, organization: { id: ids.org, name: organizationEdit.body.data.name } },
      { id: independentEvent.id, title: independentEvent.title, organization: null },
      { id: foreignEvent.id, title: foreignEvent.title, organization: { id: ids.foreignOrg, name: foreignOrg.name } },
    ];
    const salesRows = [{ totalCents: order.totalCents, platformFeeCents: order.platformFeeCents, affiliateCommissionCents: order.affiliateCommissionCents, paidAt: order.paidAt, event: salesEvents[0] }];
    const generatedOrders = [];
    const salesNow = Date.now();
    for (let index = 0; index < 1500; index += 1) {
      const fixtureEvent = salesEvents[index % salesEvents.length];
      const totalCents = 1000 + (index % 9) * 137;
      const platformFeeCents = 99 + (index % 4) * 11;
      const affiliateCommissionCents = index % 5 === 0 ? 50 : 0;
      const paidAt = new Date(salesNow - (index % 27) * 86400000 - (index % 24) * 3600000);
      salesRows.push({ totalCents, platformFeeCents, affiliateCommissionCents, paidAt, event: fixtureEvent });
      generatedOrders.push({ buyerUserId: ids.buyer, eventId: fixtureEvent.id, status: 'paid', currency: 'USD', subtotalCents: totalCents - platformFeeCents, platformFeeCents, totalCents, affiliateCommissionCents, idempotencyKey: `sales-${index}-${crypto.randomUUID()}`, paidAt, pricingPlanSnapshot: {} });
    }
    await models.Order.bulkCreate(generatedOrders, { returning: false });
    // This paid order is outside the date window; a pending order must not be counted either.
    await models.Order.create({ buyerUserId: ids.buyer, eventId: ids.event, status: 'paid', currency: 'USD', subtotalCents: 9900, platformFeeCents: 100, totalCents: 10000, affiliateCommissionCents: 0, idempotencyKey: `outside-${crypto.randomUUID()}`, paidAt: new Date(salesNow - 40 * 86400000), pricingPlanSnapshot: {} });
    await models.Order.create({ buyerUserId: ids.buyer, eventId: ids.event, status: 'pending', currency: 'USD', subtotalCents: 9900, platformFeeCents: 100, totalCents: 10000, affiliateCommissionCents: 0, idempotencyKey: `pending-${crypto.randomUUID()}`, paidAt: new Date(salesNow), pricingPlanSnapshot: {} });
    const allSales = await request('/admin/workspace?days=30', ids.admin);
    assert.equal(allSales.status, 200, JSON.stringify(allSales.body));
    assert.deepEqual(allSales.body.data.sales, aggregateAdminSales(salesRows));
    const organizationSales = await request(`/admin/workspace?days=30&organizationId=${ids.org}`, ids.admin);
    assert.equal(organizationSales.status, 200, JSON.stringify(organizationSales.body));
    assert.deepEqual(organizationSales.body.data.sales, aggregateAdminSales(salesRows.filter((row) => row.event.organization?.id === ids.org)));
    const noSales = await request(`/admin/workspace?days=30&organizationId=${crypto.randomUUID()}`, ids.admin);
    assert.equal(noSales.status, 200);
    assert.deepEqual(noSales.body.data.sales, aggregateAdminSales([]));
    assert.equal((await request(`/admin/workspace?days=30&organizationId=${encodeURIComponent(`${ids.org}' OR 1=1 --`)}`, ids.admin)).status, 422, 'malformed filter is rejected before SQL execution');
    for (const rows of [allSales.body.data.sales.events, allSales.body.data.sales.organizations]) {
      assert.deepEqual(rows, [...rows].sort((a, b) => b.salesCents - a.salesCents || a.id.localeCompare(b.id)), 'equal revenue ties are stable by ID');
    }

    const orgRestored = await request(`/admin/management/organizations/${ids.org}/actions/restore`, ids.admin, 'POST', { reason: 'Resume the fixture business', version: orgSuspended.body.data.version });
    assert.equal(orgRestored.status, 200, JSON.stringify(orgRestored.body));
    const draft = await models.Event.create({ creatorUserId: owner.id, organizationId: ids.org, locationId: ids.locationB, title: 'Fixture Draft Event', slug: `draft-${crypto.randomUUID()}`, category: 'test', status: 'draft', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), capacity: 10, guestlistCapacity: 0, isDiscoverable: true, lifecycleState: 'active' });
    ids.draftEvent = draft.id;
    const draftSuspended = await request(`/admin/management/events/${draft.id}/actions/suspend`, ids.admin, 'POST', { reason: 'Pause draft event', version: draft.version });
    assert.equal(draftSuspended.status, 200);
    const draftRestored = await request(`/admin/management/events/${draft.id}/actions/restore`, ids.admin, 'POST', { reason: 'Resume draft event', version: draftSuspended.body.data.version });
    assert.equal(draftRestored.status, 200);
    assert.equal(draftRestored.body.data.status, 'draft', 'restore does not publish or otherwise rewrite domain status');
    assert.equal(draftRestored.body.data.lifecycleState, 'active');

    const historyAudit = await models.AuditLog.count({ where: { entityType: 'Organization', entityId: ids.org } });
    assert.ok(historyAudit >= 2, 'onboarding and lifecycle actions remain in audit history');

    const roleStartVersion = owner.version;
    const toEmployee = await request(`/admin/businesses/${ids.org}/ownership/${owner.id}/remove`, ids.admin, 'POST', { outgoingRole: 'employee', reason: 'Change business-specific role with an explicit ownership action', version: (await models.Organization.findByPk(ids.org)).version });
    assert.equal(toEmployee.status, 200, JSON.stringify(toEmployee.body));
    assert.equal((await models.User.findByPk(owner.id)).isActive, true, 'scoped role changes never suspend the global user');
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: ids.org, userId: owner.id } }), 0, 'former owner is excluded from active membership');
    const retainedOwner = await models.OrganizationOwner.unscoped().findOne({ where: { organizationId: ids.org, userId: owner.id } });
    assert.equal(retainedOwner.lifecycleState, 'archived', 'revoked scoped access is retained instead of deleted');
    assert.equal(await models.OrganizationEmployee.count({ where: { organizationId: ids.org, userId: owner.id, status: 'active' } }), 1);
    const retainedLeaderAssignment = await models.EventAffiliate.findByPk(leaderAssignment.id);
    assert.equal(retainedLeaderAssignment.status, 'active', 'same-org employee restoration preserves the organization-scoped leadership referral');
    assert.equal(retainedLeaderAssignment.accessScope, 'organization');
    const staleRole = await request(`/admin/management/users/${owner.id}/scoped-role`, ids.admin, 'POST', { organizationId: ids.org, role: 'customer', reason: 'Reject stale role change', version: roleStartVersion });
    assert.equal(staleRole.status, 409, JSON.stringify({ roleStartVersion, responseVersion: toEmployee.body.data.version, persistedVersion: (await models.User.findByPk(owner.id)).version, staleRole: staleRole.body }));
    assert.equal(staleRole.body.error.code, 'STALE_VERSION');
    const toPromoter = await request(`/admin/management/users/${owner.id}/scoped-role`, ids.admin, 'POST', { organizationId: ids.org, role: 'promoter', reason: 'Switch scoped access', version: (await models.User.findByPk(owner.id)).version });
    assert.equal(toPromoter.status, 200, JSON.stringify(toPromoter.body));
    assert.equal(await models.OrganizationEmployee.count({ where: { organizationId: ids.org, userId: owner.id, status: 'active' } }), 0);
    assert.equal(await models.OrgAffiliate.count({ where: { organizationId: ids.org, userId: owner.id, status: 'active' } }), 1);
    const orgAffiliate = await models.OrgAffiliate.findOne({ where: { organizationId: ids.org, userId: owner.id } });
    await leaderAssignment.reload();
    // Reuse the former LEADEV assignment on this event as the org-linked promoter row;
    // the independent assignment lives on a second event to respect the unique event/user key.
    await leaderAssignment.update({ orgAffiliateId: orgAffiliate.id, code: `LINKED-${crypto.randomUUID()}`, status: 'active' });
    const linkedPromoterAssignment = leaderAssignment;
    const independentPromoterAssignment = await models.EventAffiliate.create({ eventId: ids.draftEvent, userId: owner.id, code: `MANUAL-${crypto.randomUUID()}`, commissionBps: 0, guestlistAllocation: 0, status: 'active' });
    const toCustomer = await request(`/admin/management/users/${owner.id}/scoped-role`, ids.admin, 'POST', { organizationId: ids.org, role: 'customer', reason: 'Remove only this organization role', version: toPromoter.body.data.version });
    assert.equal(toCustomer.status, 200, JSON.stringify(toCustomer.body));
    assert.equal((await models.User.findByPk(owner.id)).isActive, true);
    assert.equal(await models.OrgAffiliate.count({ where: { organizationId: ids.org, userId: owner.id, status: 'active' } }), 0);
    assert.equal((await models.EventAffiliate.findByPk(linkedPromoterAssignment.id)).status, 'inactive', 'organization-derived event attribution is deactivated without deleting history');
    assert.equal((await models.EventAffiliate.findByPk(independentPromoterAssignment.id)).status, 'active', 'separately assigned event promoter scope remains active');
    assert.equal(await models.OrganizationOwner.unscoped().count({ where: { organizationId: ids.org, userId: owner.id, lifecycleState: 'archived' } }), 1);
    assert.equal((await request(`/business/events/${ids.event}/detail`, owner.id)).status, 403, 'removed scoped business access no longer authorizes management');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
    await fs.rm(mediaDir, { recursive: true, force: true });
  }
});
