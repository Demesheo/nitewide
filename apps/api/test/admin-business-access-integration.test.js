const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { request: httpRequest } = require('./support/http-client.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { signToken } = require('../src/services/auth-service');

test('unified onboarding, accepted ownership changes, manager finance, and staff permissions use PostgreSQL authorization locks', async () => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const config = getConfig();
  assert.equal(config.NODE_ENV, 'test');
  const sequelize = createSequelize(config); const models = initModels(sequelize);
  const users = {};
  for (const name of ['admin', 'ownerA', 'ownerB', 'incoming', 'manager', 'readOnly', 'support', 'operations', 'recovery', 'staleIncoming', 'revokedIncoming']) users[name] = crypto.randomUUID();
  let server;
  try {
    await sequelize.authenticate();
    await models.User.bulkCreate(Object.entries(users).map(([name, id]) => ({ id, email: `${id}@access.integration.test`, displayName: name, emailVerifiedAt: new Date(), isInternalAdmin: ['admin', 'readOnly', 'support', 'operations'].includes(name), internalAdminRole: ({ admin: 'platform_owner', readOnly: 'read_only', support: 'support', operations: 'operations' })[name] || null })));
    const app = createApp({ sequelize, models, config: { ...config, NODE_ENV: 'production' }, services: { email: { enabled: false, queue: async () => { throw new Error('Access tests must never queue or send email'); } } } });
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
    async function request(route, userId = users.admin, method = 'GET', body) {
      let token = null;
      if (userId) { const seconds = Math.floor(Date.now() / 1000); const session = await models.AuthSession.create({ userId, expiresAt: new Date((seconds + 600) * 1000) }); token = signToken({ sub: userId, sid: session.id, iat: seconds, exp: seconds + 600, pwd: null }, config.AUTH_TOKEN_SECRET); }
      return httpRequest(server, `/api${route}`, { method, token, body });
    }
    const why = 'Confirmed isolated business access request';
    const recipient = (id) => ({ email: `${id}@access.integration.test`, displayName: 'Invited Owner' });
    // Email remains disabled. The test directly provisions a known hashed token
    // in its isolated database to exercise acceptance, never a send simulation.
    async function arm(response) { assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.delivery, 'unavailable'); assert.equal('token' in response.body.data, false); const raw = crypto.randomBytes(32).toString('base64url'); await models.OnboardingInvitation.update({ tokenHash: crypto.createHash('sha256').update(raw).digest('hex') }, { where: { id: response.body.data.id } }); return raw; }
    async function accept(response, userId) { const token = await arm(response); const result = await request('/auth/onboarding/accept', userId, 'POST', { token }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result; }
    async function version(id) { return (await models.Organization.findByPk(id)).version; }

    // Same names and different venue cities must never compete for identity.
    const slugBusinesses = [];
    for (const [index, city] of ['Orlando', 'Miami'].entries()) {
      const response = await request('/admin/onboarding', users.admin, 'POST', { kind: 'venue', recipient: { email: `slug-${crypto.randomUUID()}@access.integration.test`, displayName: 'Duplicate Name Contact' },
        organization: { name: 'Café Same Name', ...(index === 0 ? { slug: 'client-cannot-choose-this' } : {}) },
        venues: [{ name: 'Café Same Name', addressLine1: '100 Main Street', city, countryCode: 'US', timezone: 'America/New_York' }], confirmedAuthority: true, reason: why });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.data.delivery, 'unavailable');
      const business = await models.Organization.findByPk(response.body.data.organizationId);
      assert.match(business.slug, /^cafe-same-name-[a-f0-9-]{36}$/);
      assert.equal((await models.Location.findByPk(business.locationId)).city, city);
      slugBusinesses.push(business);
    }
    assert.notEqual(slugBusinesses[0].slug, slugBusinesses[1].slug); assert.notEqual(slugBusinesses[0].locationId, slugBusinesses[1].locationId);
    const unsafeName = await request('/admin/onboarding', users.admin, 'POST', { kind: 'organization', recipient: { email: `unsafe-${crypto.randomUUID()}@access.integration.test`, displayName: 'Untrusted Name Contact' }, organization: { name: '<script>alert(1)</script> ../../ 東京 🎉' }, confirmedAuthority: true, reason: why });
    assert.equal(unsafeName.status, 201, JSON.stringify(unsafeName.body));
    const safeSlug = (await models.Organization.findByPk(unsafeName.body.data.organizationId)).slug;
    assert.match(safeSlug, /^script-alert-1-script-[a-f0-9-]{36}$/);
    const beforeSlug = slugBusinesses[0].slug;
    const changeSlug = await request(`/admin/management/organizations/${slugBusinesses[0].id}`, users.admin, 'PATCH', { slug: 'replacement-slug', reason: why, version: slugBusinesses[0].version });
    assert.equal(changeSlug.status, 422, JSON.stringify(changeSlug.body));
    assert.equal((await models.Organization.findByPk(slugBusinesses[0].id)).slug, beforeSlug, 'stored identities cannot be edited');

    const initial = await request('/admin/onboarding', users.admin, 'POST', { kind: 'organization', recipient: { ...recipient(users.manager), role: 'manager' }, organization: { name: 'Zero Venue Promotion Group', slug: `zero-${crypto.randomUUID()}` }, venues: [], confirmedAuthority: true, reason: why });
    await accept(initial, users.manager); const org = initial.body.data.organizationId;
    assert.equal((await models.Organization.findByPk(org)).locationId, null);
    assert.equal((await models.Organization.findByPk(org)).onboardingEstablished, false);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, role: 'owner' } }), 0);
    assert.equal((await models.OrganizationOwner.findOne({ where: { organizationId: org, userId: users.manager } })).role, 'admin');
    const { createPermissionService } = require('../src/services/permission-service'); const permissions = createPermissionService(models);
    assert.equal(await permissions.canManageOrganization(users.manager, org), true);
    assert.equal(await permissions.canManageFinance(users.manager, org), false);
    const initialFinance = await request(`/admin/businesses/${org}/finance/${users.manager}`, users.admin, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) });
    assert.equal(initialFinance.status, 200, JSON.stringify(initialFinance.body)); assert.equal(await permissions.canManageFinance(users.manager, org), true, 'internal admin may grant finance before the first owner exists');
    const pendingA = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.ownerA), reason: why, version: await version(org) });
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, role: 'owner' } }), 0, 'an invitation grants no ownership');
    await accept(pendingA, users.ownerA);
    assert.equal((await models.Organization.findByPk(org)).onboardingEstablished, true);
    await accept(await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.ownerB), reason: why, version: await version(org) }), users.ownerB);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, role: 'owner' } }), 2, 'adding a co-owner preserves existing owners');
    assert.equal((await request(`/admin/businesses/${org}/ownership/${users.ownerB}/remove`, users.ownerA, 'POST', { outgoingRole: 'remove', reason: why, version: await version(org) })).status, 403);
    assert.equal((await request(`/admin/businesses/${org}/ownership/invitations`, users.readOnly, 'POST', { recipient: recipient(users.incoming), reason: why, version: await version(org) })).status, 403);

    const financeRoute = `/business/organizations/${org}/members/${users.manager}/finance`;
    assert.equal((await request(financeRoute, users.manager, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) })).status, 403, 'operational managers cannot grant themselves finance');
    const granted = await request(financeRoute, users.ownerA, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) }); assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal((await models.OrganizationOwner.findOne({ where: { organizationId: org, userId: users.manager } })).financeAuthorized, true);
    for (const userId of [users.ownerA, users.manager, users.admin]) {
      const team = await request(`/business/organizations/${org}/team-page`, userId);
      assert.equal(team.status, 200, JSON.stringify(team.body));
      assert.equal(team.body.data.canGrantFinance, userId === users.ownerA);
      assert.equal(team.body.data.organizationVersion, await version(org));
      assert.equal(team.body.data.items.find((member) => member.id === users.manager).financeAuthorized, true);
      const legacyTeam = await request(`/business/organizations/${org}/team`, userId);
      assert.equal(legacyTeam.status, 200, JSON.stringify(legacyTeam.body));
      assert.equal(legacyTeam.body.data.canGrantFinance, userId === users.ownerA);
    }
    const revoked = await request(financeRoute, users.ownerB, 'PUT', { financeAuthorized: false, reason: why, version: await version(org) }); assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal((await request(`/admin/businesses/${org}/finance/${users.manager}`, users.readOnly, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) })).status, 403);

    const event = await models.Event.create({ organizationId: org, creatorUserId: users.ownerA, title: 'Attribution History', slug: `history-${crypto.randomUUID()}`, category: 'test', status: 'draft', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000), capacity: 10 });
    const referral = await models.EventAffiliate.create({ eventId: event.id, userId: users.ownerA, code: `LEADEV-${crypto.randomUUID()}`, status: 'active', commissionBps: 500, guestlistAllocation: 2 });
    await require('../src/services/business-read-service').createBusinessReadService({ models }).bootstrap(users.support);
    const supportBootstrap = await request('/business/bootstrap', users.support); assert.equal(supportBootstrap.status, 200, JSON.stringify(supportBootstrap.body)); assert.equal(supportBootstrap.body.data.organizations.length, 0, 'support staff have no global business-report scope');
    const readonlyBootstrap = await request('/business/bootstrap', users.readOnly); assert.equal(readonlyBootstrap.status, 200, JSON.stringify(readonlyBootstrap.body)); assert.ok(readonlyBootstrap.body.data.organizations.length > 0); assert.ok(readonlyBootstrap.body.data.organizations.every((business) => !business.canManage && !business.canInviteManager));
    assert.equal(readonlyBootstrap.body.data.scope.canCreateIndependent, false);
    const readonlyEvents = await request('/business/events', users.readOnly); assert.equal(readonlyEvents.status, 200, JSON.stringify(readonlyEvents.body)); assert.ok(readonlyEvents.body.data.items.every((row) => !row.canManage && !row.canEdit));
    assert.equal((await request(`/business/events/${event.id}/detail`, users.readOnly)).status, 403);
    assert.equal((await request(`/business/events/${event.id}/summary`, users.support)).status, 404);
    assert.equal((await request(`/business/events/${event.id}/summary`, users.operations)).status, 200);
    for (const userId of [users.support, users.readOnly]) assert.equal((await request(`/business/events/${event.id}/people`, userId, 'PUT', { userId: users.manager, commissionBps: 500, status: 'active' })).status, 403, 'legacy event team endpoints cannot expand staff write permissions');
    const admissionEvent = await models.Event.create({ organizationId: org, creatorUserId: users.ownerA, title: 'Admission Permission Scope', slug: `admit-${crypto.randomUUID()}`, category: 'test', status: 'published', startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 3600000), capacity: 10 });
    for (const userId of [users.support, users.readOnly]) {
      const admissions = await request('/business/admissions/events', userId); assert.equal(admissions.status, 200, JSON.stringify(admissions.body)); assert.equal(admissions.body.data.items.length, 0);
      assert.equal((await request(`/business/admissions/events/${admissionEvent.id}`, userId)).status, 403);
    }
    assert.equal((await request(`/business/admissions/events/${admissionEvent.id}`, users.operations)).status, 200);
    const transfer = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.incoming), outgoingOwnerUserId: users.ownerA, outgoingRole: 'employee', reason: why, version: await version(org) });
    const transferToken = await arm(transfer);
    assert.equal((await models.OrganizationOwner.findOne({ where: { organizationId: org, userId: users.ownerA } })).role, 'owner');
    const both = await Promise.all([request('/auth/onboarding/accept', users.incoming, 'POST', { token: transferToken }), request('/auth/onboarding/accept', users.incoming, 'POST', { token: transferToken })]);
    assert.deepEqual(both.map((result) => result.status).sort(), [200, 409]);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, userId: users.incoming, role: 'owner' } }), 1);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, userId: users.ownerB, role: 'owner' } }), 1, 'unrelated co-owner remains');
    assert.equal((await models.OrganizationEmployee.findOne({ where: { organizationId: org, userId: users.ownerA } })).status, 'active');
    assert.equal((await models.EventAffiliate.findByPk(referral.id)).status, 'active');
    assert.equal((await models.EventAffiliate.findByPk(referral.id)).commissionBps, 500, 'historical referral terms remain');
    assert.equal((await request(`/business/organizations/${org}/members/${users.ownerA}/finance`, users.ownerB, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) })).status, 409, 'finance grants apply only to managers, not retained employees');
    const removed = await request(`/admin/businesses/${org}/ownership/${users.ownerB}/remove`, users.admin, 'POST', { outgoingRole: 'manager', reason: why, version: await version(org) }); assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const retained = await models.OrganizationOwner.findOne({ where: { organizationId: org, userId: users.ownerB } }); assert.equal(retained.role, 'admin'); assert.equal(retained.financeAuthorized, false);
    const last = await request(`/admin/businesses/${org}/ownership/${users.incoming}/remove`, users.admin, 'POST', { outgoingRole: 'remove', reason: why, version: await version(org) }); assert.equal(last.status, 409); assert.equal(last.body.error.code, 'LAST_ORGANIZATION_OWNER');

    const stale = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.staleIncoming), outgoingOwnerUserId: users.incoming, outgoingRole: 'remove', reason: why, version: await version(org) }); const staleToken = await arm(stale);
    await request(financeRoute, users.incoming, 'PUT', { financeAuthorized: true, reason: why, version: await version(org) });
    const staleAccept = await request('/auth/onboarding/accept', users.staleIncoming, 'POST', { token: staleToken }); assert.equal(staleAccept.status, 409); assert.equal(staleAccept.body.error.code, 'OWNERSHIP_INVITATION_STALE');
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, userId: users.incoming, role: 'owner' } }), 1);
    await models.OnboardingInvitation.update({ revokedAt: new Date() }, { where: { id: stale.body.data.id } });
    const expiry = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.staleIncoming), reason: why, version: await version(org) }); const expiryToken = await arm(expiry); await models.OnboardingInvitation.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: expiry.body.data.id } });
    assert.equal((await request('/auth/onboarding/accept', users.staleIncoming, 'POST', { token: expiryToken })).status, 409);
    const unavailable = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.staleIncoming), reason: why, version: await version(org) }); const unavailableToken = await arm(unavailable);
    await models.User.update({ internalAdminRole: 'read_only' }, { where: { id: users.admin } });
    assert.equal((await request('/auth/onboarding/accept', users.staleIncoming, 'POST', { token: unavailableToken })).status, 409, 'revoked inviter authority blocks acceptance');
    await models.User.update({ internalAdminRole: 'platform_owner' }, { where: { id: users.admin } });
    await models.Organization.update({ lifecycleState: 'suspended', status: 'suspended' }, { where: { id: org } });
    assert.equal((await request('/auth/onboarding/accept', users.staleIncoming, 'POST', { token: unavailableToken })).status, 409, 'business lifecycle blocks acceptance');
    await models.Organization.update({ lifecycleState: 'active', status: 'active' }, { where: { id: org } });
    const recoveryOrg = await models.Organization.create({ name: 'Recovery Workspace', slug: `recover-${crypto.randomUUID()}` });
    assert.equal((await request(`/admin/businesses/${recoveryOrg.id}/ownership/recovery`, users.admin, 'POST', { userId: users.recovery, reason: why, version: recoveryOrg.version })).status, 422);
    const recovery = await request(`/admin/businesses/${recoveryOrg.id}/ownership/recovery`, users.admin, 'POST', { userId: users.recovery, reason: why, version: recoveryOrg.version, confirmed: true }); assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
    assert.equal(await models.AuditLog.count({ where: { organizationId: recoveryOrg.id, action: 'admin.ownership.recovery_override' } }), 1);
    assert.equal((await request(`/admin/businesses/${recoveryOrg.id}/ownership/recovery`, users.admin, 'POST', { userId: users.ownerA, reason: why, version: await version(recoveryOrg.id), confirmed: true })).status, 409);
    const revokedEmployee = await models.OrganizationEmployee.create({ organizationId: org, userId: users.revokedIncoming, status: 'active' });
    const revokedInvite = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.revokedIncoming), reason: why, version: await version(org) }); const revokedToken = await arm(revokedInvite);
    await revokedEmployee.update({ status: 'inactive' });
    const revokedAccept = await request('/auth/onboarding/accept', users.revokedIncoming, 'POST', { token: revokedToken }); assert.equal(revokedAccept.status, 409); assert.equal(revokedAccept.body.error.code, 'OWNERSHIP_INVITATION_STALE', 'revoking the incoming employee invalidates their earlier ownership invitation');
    const changedInitial = await request('/admin/onboarding', users.admin, 'POST', { kind: 'organization', recipient: { ...recipient(users.recovery), role: 'manager' }, organization: { name: 'Changed Initial Contact', slug: `changed-initial-${crypto.randomUUID()}` }, confirmedAuthority: true, reason: why });
    const changedInitialToken = await arm(changedInitial); const changedOrg = changedInitial.body.data.organizationId;
    const recoveredInitial = await request(`/admin/businesses/${changedOrg}/ownership/recovery`, users.admin, 'POST', { userId: users.recovery, reason: why, version: await version(changedOrg), confirmed: true }); assert.equal(recoveredInitial.status, 200, JSON.stringify(recoveredInitial.body));
    const changedAccept = await request('/auth/onboarding/accept', users.recovery, 'POST', { token: changedInitialToken }); assert.equal(changedAccept.status, 409); assert.equal(changedAccept.body.error.code, 'OWNERSHIP_INVITATION_STALE');
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: changedOrg, userId: users.recovery, role: 'owner' } }), 1, 'initial manager acceptance cannot overwrite a later recovery ownership grant');
    const managerTransfer = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.ownerA), outgoingOwnerUserId: users.incoming, outgoingRole: 'manager', reason: why, version: await version(org) });
    await accept(managerTransfer, users.ownerA);
    const formerIncoming = await models.OrganizationOwner.findOne({ where: { organizationId: org, userId: users.incoming } });
    assert.equal(formerIncoming.role, 'admin'); assert.equal(formerIncoming.financeAuthorized, false, 'transfer retention never carries implicit owner finance into the manager role');
    assert.equal((await models.OrganizationEmployee.findOne({ where: { organizationId: org, userId: users.ownerA } })).status, 'inactive', 'accepting ownership promotes only the invited membership');
    const removeTransfer = await request(`/admin/businesses/${org}/ownership/invitations`, users.admin, 'POST', { recipient: recipient(users.ownerB), outgoingOwnerUserId: users.ownerA, outgoingRole: 'remove', reason: why, version: await version(org) });
    await accept(removeTransfer, users.ownerB);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: org, userId: users.ownerA } }), 0);
    assert.equal((await models.EventAffiliate.findByPk(referral.id)).status, 'inactive', 'removal revokes organization scope while preserving the referral record');
    assert.equal((await models.EventAffiliate.findByPk(referral.id)).commissionBps, 500);
    const raceOrg = await models.Organization.create({ name: 'Concurrent Owner Removals', slug: `race-${crypto.randomUUID()}` });
    await models.OrganizationOwner.bulkCreate([{ organizationId: raceOrg.id, userId: users.ownerA }, { organizationId: raceOrg.id, userId: users.ownerB }]);
    const race = await Promise.all([users.ownerA, users.ownerB].map((userId) => request(`/admin/businesses/${raceOrg.id}/ownership/${userId}/remove`, users.admin, 'POST', { outgoingRole: 'remove', reason: why, version: raceOrg.version })));
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: raceOrg.id, role: 'owner' } }), 1, 'concurrent removals cannot remove every owner');
    const managerOnly = await models.Organization.create({ name: 'Initial Manager Exception', slug: `initial-manager-${crypto.randomUUID()}`, onboardingEstablished: false });
    await models.OrganizationOwner.create({ organizationId: managerOnly.id, userId: users.manager, role: 'admin', financeAuthorized: true });
    const managerChange = await request(`/admin/management/users/${users.manager}/scoped-role`, users.admin, 'POST', { organizationId: managerOnly.id, role: 'employee', reason: why, version: (await models.User.findByPk(users.manager)).version });
    assert.equal(managerChange.status, 200, JSON.stringify(managerChange.body));
    assert.equal(await models.OrganizationOwner.count({ where: { organizationId: managerOnly.id, role: 'owner' } }), 0, 'initial manager workflows never manufacture an owner');
    assert.equal((await models.OrganizationOwner.unscoped().findOne({ where: { organizationId: managerOnly.id, userId: users.manager } })).financeAuthorized, false);
    assert.equal(await permissions.canManageFinance(users.manager, managerOnly.id), false);
    const detail = await request(`/admin/businesses/${org}/ownership`); assert.equal(detail.status, 200, JSON.stringify(detail.body)); assert.equal(detail.body.data.owners.length, 1); assert.equal(detail.body.data.managers.length, 2);
    assert.equal(JSON.stringify(detail.body).includes(transferToken), false);
    assert.equal(JSON.stringify(await models.AuditLog.findAll()).includes(transferToken), false);
  } finally { if (server) await new Promise((resolve) => server.close(resolve)); await sequelize.close(); }
});
