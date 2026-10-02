const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('./support/http-client.cjs');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

test('authorized event save reactivates a manager referral while preserving snapshots and blocking stale org codes', async () => {
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
  const rejoinRoles = ['manager', 'employee', 'affiliate'];
  const rejoinCases = rejoinRoles.flatMap((removedRole, fromIndex) => rejoinRoles.map((restoredRole, toIndex) => ({
    removedRole, restoredRole, userKey: `rejoinUser${fromIndex}${toIndex}`, affiliateKey: `rejoinAffiliate${fromIndex}${toIndex}`,
    eventAffiliateKey: `rejoinEventAffiliate${fromIndex}${toIndex}`, otherEventAffiliateKey: `rejoinOtherEventAffiliate${fromIndex}${toIndex}`,
    orderKey: `rejoinOrder${fromIndex}${toIndex}`, commissionSnapshot: 130 + fromIndex * 3 + toIndex,
  })));
  const ids = Object.fromEntries(['owner', 'ownerInherited', 'promoter', 'rolePromoter', 'adminRolePromoter', 'internalAdmin', 'buyer', 'guest', 'organization', 'location', 'event', 'secondaryEvent', 'sourceRegrantEvent', 'orgAffiliate', 'orgAffiliateInherited', 'roleOrgAffiliate', 'adminRoleOrgAffiliate', 'eventAffiliate', 'eventAffiliateInherited', 'roleEventAffiliate', 'adminRoleEventAffiliate', 'independentEventAffiliate', 'order', 'rejoinGuestlist', 'guestlist', ...rejoinCases.flatMap((scenario) => [scenario.userKey, scenario.affiliateKey, scenario.eventAffiliateKey, scenario.otherEventAffiliateKey, scenario.orderKey])].map((key) => [key, randomUUID()]));
  const startedAt = new Date(Date.now() + 24 * 60 * 60_000);
  const endedAt = new Date(startedAt.getTime() + 4 * 60 * 60_000);
  const organizationWindowStart = new Date(Date.now() - 60_000);
  const organizationWindowEnd = new Date(endedAt.getTime() - 60_000);
  let server;
  const queuedEmails = [];

  try {
    await sequelize.authenticate();
    await m.User.bulkCreate([
      { id: ids.owner, email: `manager-${ids.owner}@fixture.nitewide.test`, displayName: 'Fixture Manager', isActive: true },
      { id: ids.ownerInherited, email: `inherited-${ids.ownerInherited}@fixture.nitewide.test`, displayName: 'Fixture Inherited Manager', isActive: true },
      { id: ids.promoter, email: `promoter-${ids.promoter}@fixture.nitewide.test`, displayName: 'Fixture Promoter', isActive: true },
      { id: ids.rolePromoter, email: `role-promoter-${ids.rolePromoter}@fixture.nitewide.test`, displayName: 'Fixture Role Change Promoter', isActive: true, independentCreator: true },
      { id: ids.adminRolePromoter, email: `admin-role-promoter-${ids.adminRolePromoter}@fixture.nitewide.test`, displayName: 'Fixture Admin Role Promoter', isActive: true },
      { id: ids.internalAdmin, email: `internal-admin-${ids.internalAdmin}@fixture.nitewide.test`, displayName: 'Fixture Internal Admin', isActive: true, isInternalAdmin: true },
      { id: ids.buyer, email: `buyer-${ids.buyer}@fixture.nitewide.test`, displayName: 'Fixture Buyer', isActive: true },
      { id: ids.guest, email: `guest-${ids.guest}@fixture.nitewide.test`, displayName: 'Fixture Guest', isActive: true },
      ...rejoinCases.map((scenario) => ({ id: ids[scenario.userKey], email: `rejoin-${scenario.removedRole}-${scenario.restoredRole}-${ids[scenario.userKey]}@fixture.nitewide.test`, displayName: `Rejoin ${scenario.removedRole} to ${scenario.restoredRole}`, isActive: true })),
    ]);
    await m.Location.create({ id: ids.location, name: 'Referral Fixture Room', addressLine1: '1 Test Way', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' });
    await m.Organization.create({ id: ids.organization, name: 'Referral Fixture Org', slug: `referral-fixture-${ids.organization}`, locationId: ids.location });
    await m.OrganizationOwner.bulkCreate([
      { organizationId: ids.organization, userId: ids.owner, role: 'admin' },
      { organizationId: ids.organization, userId: ids.ownerInherited, role: 'admin' },
      ...rejoinCases.filter((scenario) => scenario.removedRole === 'manager').map((scenario) => ({ organizationId: ids.organization, userId: ids[scenario.userKey], role: 'admin' })),
    ]);
    await m.OrganizationEmployee.bulkCreate(rejoinCases.filter((scenario) => scenario.removedRole === 'employee').map((scenario) => ({ organizationId: ids.organization, userId: ids[scenario.userKey], status: 'active' })));
    await m.OrgAffiliate.bulkCreate([
      { id: ids.orgAffiliate, organizationId: ids.organization, userId: ids.owner, code: `ORG-${ids.orgAffiliate.slice(0, 8)}`, defaultCommissionBps: 700, defaultGuestlistAllocation: 10, startsAt: organizationWindowStart, endsAt: organizationWindowEnd, status: 'inactive' },
      { id: ids.orgAffiliateInherited, organizationId: ids.organization, userId: ids.ownerInherited, code: `ORG-${ids.orgAffiliateInherited.slice(0, 8)}`, defaultCommissionBps: 700, defaultGuestlistAllocation: 10, status: 'inactive' },
      { id: ids.roleOrgAffiliate, organizationId: ids.organization, userId: ids.rolePromoter, code: `ORG-${ids.roleOrgAffiliate.slice(0, 8)}`, defaultCommissionBps: 900, defaultGuestlistAllocation: 8, startsAt: organizationWindowStart, endsAt: organizationWindowEnd, status: 'active' },
      { id: ids.adminRoleOrgAffiliate, organizationId: ids.organization, userId: ids.adminRolePromoter, code: `ORG-${ids.adminRoleOrgAffiliate.slice(0, 8)}`, defaultCommissionBps: 1100, defaultGuestlistAllocation: 7, status: 'active' },
      { organizationId: ids.organization, userId: ids.promoter, code: `ORG-${ids.promoter.slice(0, 8)}`, defaultCommissionBps: 700, defaultGuestlistAllocation: 10, status: 'inactive' },
      ...rejoinCases.filter((scenario) => scenario.removedRole === 'affiliate').map((scenario) => ({ id: ids[scenario.affiliateKey], organizationId: ids.organization, userId: ids[scenario.userKey], code: `ORG-${ids[scenario.affiliateKey].slice(0, 8)}`, defaultCommissionBps: 800, defaultGuestlistAllocation: 6, status: 'active' })),
    ]);
    const stalePromoterAffiliate = await m.OrgAffiliate.findOne({ where: { userId: ids.promoter, organizationId: ids.organization } });
    await m.Event.create({ id: ids.event, creatorUserId: ids.owner, organizationId: ids.organization, locationId: ids.location, title: 'Referral Reactivation Fixture', slug: `referral-reactivation-${ids.event}`, category: 'music', status: 'published', startsAt: startedAt, endsAt: endedAt, capacity: 50, guestlistCapacity: 10, isDiscoverable: true });
    await m.Event.create({ id: ids.secondaryEvent, creatorUserId: ids.owner, organizationId: ids.organization, locationId: ids.location, title: 'Independent Referral Fixture', slug: `independent-referral-${ids.secondaryEvent}`, category: 'music', status: 'published', startsAt: startedAt, endsAt: endedAt, capacity: 50, guestlistCapacity: 10, isDiscoverable: false });
    await m.Event.create({ id: ids.sourceRegrantEvent, creatorUserId: ids.owner, organizationId: ids.organization, locationId: ids.location, title: 'Detached Source Snapshot Fixture', slug: `source-regrant-${ids.sourceRegrantEvent}`, category: 'music', status: 'published', startsAt: startedAt, endsAt: endedAt, capacity: 50, guestlistCapacity: 10, isDiscoverable: false });
    await m.EventAffiliate.bulkCreate([
      { id: ids.eventAffiliate, eventId: ids.event, userId: ids.owner, orgAffiliateId: ids.orgAffiliate, code: `NW-${ids.eventAffiliate.slice(0, 8)}`, commissionBps: 1000, guestlistAllocation: 10, startsAt: new Date(organizationWindowStart.getTime() - 60_000), endsAt: endedAt, status: 'inactive' },
      { id: ids.eventAffiliateInherited, eventId: ids.event, userId: ids.ownerInherited, orgAffiliateId: ids.orgAffiliateInherited, code: `NW-${ids.eventAffiliateInherited.slice(0, 8)}`, commissionBps: null, guestlistAllocation: null, status: 'inactive' },
      { id: ids.roleEventAffiliate, eventId: ids.event, userId: ids.rolePromoter, orgAffiliateId: ids.roleOrgAffiliate, code: `NW-${ids.roleEventAffiliate.slice(0, 8)}`, commissionBps: null, guestlistAllocation: null, startsAt: new Date(organizationWindowStart.getTime() - 60_000), endsAt: endedAt, status: 'active' },
      { id: ids.adminRoleEventAffiliate, eventId: ids.event, userId: ids.adminRolePromoter, orgAffiliateId: ids.adminRoleOrgAffiliate, code: `NW-${ids.adminRoleEventAffiliate.slice(0, 8)}`, commissionBps: null, guestlistAllocation: null, status: 'active' },
      { eventId: ids.event, userId: ids.promoter, orgAffiliateId: stalePromoterAffiliate.id, code: `NW-${ids.promoter.slice(0, 8)}`, commissionBps: 1500, guestlistAllocation: 6, status: 'inactive' },
      { eventId: ids.sourceRegrantEvent, userId: ids.promoter, orgAffiliateId: null, sourceOrgAffiliateId: stalePromoterAffiliate.id,
        code: `NW-SOURCE-${ids.promoter.slice(0, 8)}`, commissionBps: 1500, guestlistAllocation: 6,
        startsAt: organizationWindowStart, endsAt: endedAt, status: 'inactive', accessScope: 'organization' },
      ...rejoinCases.map((scenario, index) => ({ id: ids[scenario.eventAffiliateKey], eventId: ids.event, userId: ids[scenario.userKey],
        orgAffiliateId: scenario.removedRole === 'affiliate' ? ids[scenario.affiliateKey] : null,
        code: `${scenario.removedRole === 'manager' ? 'LEADEV' : scenario.removedRole === 'employee' ? 'STAFFEV' : 'NW'}-RJ${index}-${ids[scenario.eventAffiliateKey].slice(0, 8)}`, commissionBps: 1300 + index, guestlistAllocation: 6,
        startsAt: organizationWindowStart, endsAt: organizationWindowEnd, status: 'active', accessScope: 'organization' })),
      ...rejoinCases.map((scenario, index) => ({ id: ids[scenario.otherEventAffiliateKey], eventId: ids.secondaryEvent, userId: ids[scenario.userKey],
        code: `NW-RO${index}-${ids[scenario.otherEventAffiliateKey].slice(0, 8)}`, commissionBps: 1200 + index, guestlistAllocation: 4,
        startsAt: organizationWindowStart, endsAt: organizationWindowEnd, status: 'active', accessScope: 'organization' })),
    ]);
    const stalePromoterOtherAssignment = await m.EventAffiliate.create({ eventId: ids.secondaryEvent, userId: ids.promoter,
      orgAffiliateId: stalePromoterAffiliate.id, code: `NW-STALE-OTHER-${ids.promoter.slice(0, 8)}`,
      commissionBps: 1500, guestlistAllocation: 6, status: 'inactive', accessScope: 'organization' });
    const priorOrder = await m.Order.create({ id: ids.order, buyerUserId: ids.buyer, eventId: ids.event, status: 'paid', currency: 'USD', subtotalCents: 12000, platformFeeCents: 996, totalCents: 12996, affiliateCommissionCents: 1200, eventAffiliateId: ids.eventAffiliate, idempotencyKey: `reactivation-${ids.order}`, paidAt: new Date() });
    await m.Order.bulkCreate(rejoinCases.map((scenario) => ({ id: ids[scenario.orderKey], buyerUserId: ids.buyer, eventId: ids.event, status: 'paid', currency: 'USD', subtotalCents: 1000, platformFeeCents: 83, totalCents: 1083, affiliateCommissionCents: scenario.commissionSnapshot, eventAffiliateId: ids[scenario.eventAffiliateKey], idempotencyKey: `reactivation-${ids[scenario.orderKey]}`, paidAt: new Date() })));
    await m.GuestlistEntry.create({ id: ids.rejoinGuestlist, eventId: ids.event, userId: ids.buyer, eventAffiliateId: ids[rejoinCases[0].eventAffiliateKey], source: 'affiliate', partySize: 2, status: 'confirmed' });
    const priorGuest = await m.GuestlistEntry.create({ id: ids.guestlist, eventId: ids.event, userId: ids.guest, eventAffiliateId: ids.eventAffiliate, source: 'affiliate', partySize: 3, status: 'confirmed' });

    server = createApp({ sequelize, models: m, config, services: { email: { enabled: true, queue: async (message) => { queuedEmails.push(message); return { id: randomUUID() }; } } } }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function request(path, role = 'owner', method = 'GET', body) {
      const userId = role === null || role === undefined ? ids.owner : (ids[role] || role);
      const issuedAt = Math.floor(Date.now() / 1000);
      const session = await m.AuthSession.create({ userId, expiresAt: new Date((issuedAt + 300) * 1000) });
      const token = signToken({ sub: userId, sid: session.id, iat: issuedAt, exp: issuedAt + 300, pwd: null }, config.AUTH_TOKEN_SECRET);
      const response = await httpRequest(server, `/api${path}`, { method, token, body });
      return { status: response.status, ...response.body };
    }

    const referralPath = `/business/events/${ids.event}/referral-link`;
    const promoterCode = `NW-${ids.promoter.slice(0, 8)}`;
    const staleOrgCode = `ORG-${ids.orgAffiliate.slice(0, 8)}`;
    assert.equal((await request(referralPath)).status, 403, 'an inactive event assignment is not reactivated by reading ownLink');
    assert.equal((await request(referralPath, 'promoter')).status, 403, 'a nonmanager with an inactive organization affiliate cannot retrieve or revive an event link');
    assert.equal((await request(`/events/${ids.event}/referral-visits`, null, 'POST', { code: promoterCode })).status, 400, 'inactive assignment code is blocked before an explicit save');
    const managerBypass = await request(`/business/events/${ids.event}/people`, 'promoter', 'PUT', { userId: ids.promoter, commissionBps: 1500, status: 'active' });
    assert.equal(managerBypass.status, 403, 'an ordinary promoter cannot use the manager save endpoint');
    assert.equal((await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } })).status, 'inactive');
    const blockedPromoterSave = await request(`/business/events/${ids.event}/people`, 'owner', 'PUT', { userId: ids.promoter, commissionBps: 1500, status: 'active' });
    assert.equal(blockedPromoterSave.status,422);
    assert.equal(blockedPromoterSave.error.code,'COMMISSION_ONBOARDING_REQUIRED');
    assert.equal((await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } })).commissionBps,1500,'rejected terms leave stored rates intact');
    const stalePromoterSave = await request(`/business/events/${ids.event}/people`, 'owner', 'PUT', { userId: ids.promoter, commissionBps: 0, status: 'active' });
    assert.equal(stalePromoterSave.status, 200, JSON.stringify(stalePromoterSave));
    assert.equal(stalePromoterSave.data.id, (await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } })).id);
    assert.equal(stalePromoterSave.data.accessScope, 'event', 'an explicit manager re-add without current org membership restores only event scope');
    assert.equal(stalePromoterSave.data.orgAffiliateId, null);
    assert.equal(stalePromoterSave.data.sourceOrgAffiliateId, null);
    assert.equal(stalePromoterSave.data.commissionBps, 0);
    assert.equal(stalePromoterSave.data.guestlistAllocation, 6);
    assert.equal((await request(referralPath, 'promoter')).status, 200, 'the explicitly restored event assignment returns its referral URL');
    const stalePromoterPools = await request(`/business/events/${ids.event}/guestlist-invite-pools`, 'promoter');
    assert.equal(stalePromoterPools.status, 200, JSON.stringify(stalePromoterPools));
    assert.ok(stalePromoterPools.data.own.some((pool) => pool.guestlistAllocation === 6));
    await stalePromoterOtherAssignment.reload();
    assert.equal(stalePromoterOtherAssignment.status, 'inactive', 'manager restoration affects only the selected event assignment');
    assert.equal((await request(`/business/events/${ids.secondaryEvent}/referral-link`, 'promoter')).status, 403,
      'restoring one event does not revive the user’s other revoked organization-scoped assignment');
    await stalePromoterAffiliate.update({ endsAt: new Date(Date.now() - 60_000) });
    const sourceRegrantAssignment = await m.EventAffiliate.findOne({ where: { eventId: ids.sourceRegrantEvent, userId: ids.promoter } });
    const sourceRegrant = await request(`/business/events/${ids.sourceRegrantEvent}/people`, 'owner', 'PUT', {
      userId: ids.promoter, commissionBps: 0, status: 'active',
    });
    assert.equal(sourceRegrant.status, 200, JSON.stringify(sourceRegrant));
    assert.equal(sourceRegrant.data.id, sourceRegrantAssignment.id);
    assert.equal(sourceRegrant.data.code, sourceRegrantAssignment.code);
    assert.equal(sourceRegrant.data.accessScope, 'event');
    assert.equal(sourceRegrant.data.orgAffiliateId, null);
    assert.equal(sourceRegrant.data.sourceOrgAffiliateId, null);
    assert.equal(sourceRegrant.data.guestlistAllocation, 6);
    assert.equal(new Date(sourceRegrant.data.startsAt).getTime(), organizationWindowStart.getTime());
    assert.equal(new Date(sourceRegrant.data.endsAt).getTime(), endedAt.getTime(),
      'detached source provenance cannot replace the reactivated event assignment’s valid effective window with an expired source window');
    assert.equal((await request(`/business/events/${ids.sourceRegrantEvent}/referral-link`, 'promoter')).status, 200,
      'the source-only detached event referral remains usable after its former org source expires');

    const saved = await request(`/business/events/${ids.event}/people`, 'owner', 'PUT', { userId: ids.owner, commissionBps: 0, status: 'active' });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal(saved.data.id, ids.eventAffiliate);
    assert.equal(saved.data.code, `NW-${ids.eventAffiliate.slice(0, 8)}`);
    assert.equal(saved.data.status, 'active');
    assert.equal(saved.data.orgAffiliateId, null, 'the inactive organization affiliate is detached');
    assert.equal(saved.data.commissionBps, 0);
    assert.equal(saved.data.guestlistAllocation, 10, 'the event allocation survives detachment');
    assert.equal(new Date(saved.data.startsAt).getTime(), organizationWindowStart.getTime(), 'detaching retains the later effective start');
    assert.equal(new Date(saved.data.endsAt).getTime(), organizationWindowEnd.getTime(), 'detaching retains the earlier effective end');

    const inheritedSave = await request(`/business/events/${ids.event}/people`, 'ownerInherited', 'PUT', { userId: ids.ownerInherited, commissionBps: 0, status: 'active' });
    assert.equal(inheritedSave.status, 200, JSON.stringify(inheritedSave));
    assert.equal(inheritedSave.data.commissionBps, 0, 'an explicit zero commission overrides the linked organization default');
    assert.equal(inheritedSave.data.guestlistAllocation, 10, 'the inherited allocation is materialized before the inactive organization link is removed');
    assert.equal(inheritedSave.data.orgAffiliateId, null);
    assert.equal(queuedEmails.length, 4, 'explicitly replacing legacy configured terms with zero sends terms-change messages');

    const roleChange = await request(`/business/organizations/${ids.organization}/team/${ids.rolePromoter}`, 'owner', 'PATCH', { role: 'manager' });
    assert.equal(roleChange.status, 200, JSON.stringify(roleChange));
    const roleAssignment = await m.EventAffiliate.findByPk(ids.roleEventAffiliate);
    assert.equal(roleAssignment.status, 'active', 'promoter-to-manager transition preserves the event assignment status');
    assert.equal(roleAssignment.orgAffiliateId, null, 'promoter-to-manager transition detaches the inactive organization referral scope');
    assert.equal(roleAssignment.code, `NW-${ids.roleEventAffiliate.slice(0, 8)}`);
    assert.equal(roleAssignment.commissionBps, 900, 'transition materializes the organization commission default as the event term');
    assert.equal(roleAssignment.guestlistAllocation, 8, 'transition materializes the organization allocation default');
    assert.equal(new Date(roleAssignment.startsAt).getTime(), organizationWindowStart.getTime());
    assert.equal(new Date(roleAssignment.endsAt).getTime(), organizationWindowEnd.getTime());
    assert.equal(roleAssignment.sourceOrgAffiliateId, ids.roleOrgAffiliate, 'converted staff referral retains its organization source for a later role removal');
    assert.equal((await m.OrgAffiliate.findByPk(ids.roleOrgAffiliate)).status, 'inactive');
    const managerCommissionEdit = await request(`/business/events/${ids.event}/people`, 'owner', 'PUT', {
      userId: ids.rolePromoter, commissionBps: 0, status: 'active',
    });
    assert.equal(managerCommissionEdit.status, 200, JSON.stringify(managerCommissionEdit));
    assert.equal(managerCommissionEdit.data.accessScope, 'organization', 'an active commission edit by a current venue manager does not widen organization scope');
    assert.equal(managerCommissionEdit.data.sourceOrgAffiliateId, ids.roleOrgAffiliate);
    assert.equal(managerCommissionEdit.data.commissionBps, 0);
    const transitionVisit = await request(`/events/${ids.event}/referral-visits`, null, 'POST', { code: roleAssignment.code });
    assert.equal(transitionVisit.status, 200, JSON.stringify(transitionVisit));
    const adminTarget = await m.User.findByPk(ids.adminRolePromoter);
    const adminRoleChange = await request(`/admin/management/users/${ids.adminRolePromoter}/scoped-role`, 'internalAdmin', 'POST', { organizationId: ids.organization, role: 'employee', reason: 'Convert promoter to current venue staff', version: adminTarget.version });
    assert.equal(adminRoleChange.status, 200, JSON.stringify(adminRoleChange));
    const adminRoleAssignment = await m.EventAffiliate.findByPk(ids.adminRoleEventAffiliate);
    assert.equal(adminRoleAssignment.status, 'active');
    assert.equal(adminRoleAssignment.sourceOrgAffiliateId, ids.adminRoleOrgAffiliate);
    assert.equal(adminRoleAssignment.orgAffiliateId, null);
    assert.equal(adminRoleAssignment.commissionBps, 1100);
    assert.equal(adminRoleAssignment.guestlistAllocation, 7);
    assert.equal((await m.OrgAffiliate.findByPk(ids.adminRoleOrgAffiliate)).status, 'inactive');
    const independentAssignment = await m.EventAffiliate.create({ id: ids.independentEventAffiliate, eventId: ids.secondaryEvent, userId: ids.rolePromoter, code: `NW-MANUAL-${ids.independentEventAffiliate.slice(0, 8)}`, commissionBps: 500, guestlistAllocation: 0, status: 'active' });
    const removedRole = await request(`/business/organizations/${ids.organization}/team/${ids.rolePromoter}`, 'owner', 'DELETE');
    assert.equal(removedRole.status, 200, JSON.stringify(removedRole));
    const [revokedConvertedAssignment, retainedIndependentAssignment] = await Promise.all([
      m.EventAffiliate.findByPk(ids.roleEventAffiliate), m.EventAffiliate.findByPk(ids.independentEventAffiliate),
    ]);
    assert.equal(revokedConvertedAssignment.status, 'inactive', 'removing staff revokes event scope converted from the organization promoter');
    assert.equal(revokedConvertedAssignment.code, roleAssignment.code, 'revocation retains the existing code and history');
    assert.equal(revokedConvertedAssignment.sourceOrgAffiliateId, ids.roleOrgAffiliate);
    assert.equal(revokedConvertedAssignment.commissionBps, 0, 'an active commission edit does not prevent later organization removal from revoking access');
    assert.equal(retainedIndependentAssignment.status, 'active', 'staff removal preserves an independent event promoter assignment');
    assert.equal(retainedIndependentAssignment.sourceOrgAffiliateId, null);
    assert.equal((await request(`/events/${ids.secondaryEvent}/referral-visits`, null, 'POST', { code: independentAssignment.code })).status, 200);

    const link = await request(referralPath);
    assert.equal(link.status, 200, JSON.stringify(link));
    assert.equal(link.data.code, saved.data.code);
    const pools = await request(`/business/events/${ids.event}/guestlist-invite-pools`);
    assert.equal(pools.status, 200, JSON.stringify(pools));
    assert.ok(pools.data.own.some((pool) => pool.id === ids.eventAffiliate && pool.guestlistAllocation === 10));
    const validVisit = await request(`/events/${ids.event}/referral-visits`, null, 'POST', { code: saved.data.code });
    assert.equal(validVisit.status, 200, JSON.stringify(validVisit));
    assert.equal(validVisit.data.code, saved.data.code);
    const organizationAliasVisit = await request(`/events/${ids.event}/referral-visits`, null, 'POST', { code: staleOrgCode });
    assert.equal(organizationAliasVisit.status, 200, 'an active organization-scoped event assignment retains its same-user legacy organization alias');
    assert.equal(organizationAliasVisit.data.referrerName, 'Fixture Manager');
    assert.equal((await m.OrgAffiliate.findByPk(ids.orgAffiliate)).status, 'inactive', 'resolving a legacy alias does not reactivate its inactive organization affiliate');

    const [assignmentAfter, orderAfter, guestAfter, audit] = await Promise.all([
      m.EventAffiliate.findByPk(ids.eventAffiliate), m.Order.findByPk(ids.order), m.GuestlistEntry.findByPk(ids.guestlist),
      m.AuditLog.findOne({ where: { entityType: 'EventAffiliate', entityId: ids.eventAffiliate, action: 'event.referrer.updated' }, order: [['createdAt', 'DESC']] }),
    ]);
    assert.equal(assignmentAfter.id, ids.eventAffiliate);
    assert.equal(assignmentAfter.code, saved.data.code);
    assert.equal(assignmentAfter.commissionBps, 0);
    assert.equal(assignmentAfter.guestlistAllocation, 10);
    assert.equal(assignmentAfter.orgAffiliateId, null);
    assert.equal((await m.OrgAffiliate.findByPk(ids.orgAffiliate)).status, 'inactive', 'reactivating an event assignment leaves organization access inactive');
    assert.equal(orderAfter.id, priorOrder.id);
    assert.equal(orderAfter.eventAffiliateId, ids.eventAffiliate);
    assert.equal(orderAfter.affiliateCommissionCents, 1200, 'historical commission snapshot is unchanged');
    assert.equal(guestAfter.id, priorGuest.id);
    assert.equal(guestAfter.eventAffiliateId, ids.eventAffiliate);
    assert.equal(guestAfter.partySize, 3);
    assert.equal(guestAfter.status, 'confirmed');
    assert.equal(audit.before.status, 'inactive');
    assert.equal(audit.before.code, saved.data.code);
    assert.equal(audit.before.commissionBps, 1000);
    assert.equal(audit.before.guestlistAllocation, 10);
    assert.equal(audit.after.status, 'active');
    assert.equal(audit.after.orgAffiliateId, null);
    assert.equal(audit.after.code, saved.data.code);
    assert.equal(audit.after.commissionBps, 0);
    assert.equal(audit.after.guestlistAllocation, 10);

    const futureEventInput = (title, status) => ({
      organizationId: ids.organization, locationId: ids.location, title, slug: `future-${randomUUID()}`,
      summary: 'Isolated referral regression fixture', description: '', category: 'music',
      startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      capacity: 50, guestlistCapacity: 20, status, isDiscoverable: false,
      offerings: [{ name: 'Fixture ticket', description: '', kind: 'ticket', priceCents: 1000, inventoryMode: 'finite',
        quantityTotal: 50, entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 10, isActive: true, visibility: 'public' }],
    });
    const futureEventResponse = await request('/business/events', 'owner', 'POST', futureEventInput('New future referral event', 'published'));
    assert.equal(futureEventResponse.status, 201, JSON.stringify(futureEventResponse));
    const futureEventId = futureEventResponse.data.id;

    const freshManagerLink = await request(`/business/events/${futureEventId}/referral-link`, 'owner');
    assert.equal(freshManagerLink.status, 200, JSON.stringify(freshManagerLink));
    assert.match(freshManagerLink.data.code, /^LEADEV-/);
    const freshEmployeeLink = await request(`/business/events/${futureEventId}/referral-link`, 'adminRolePromoter');
    assert.equal(freshEmployeeLink.status, 200, JSON.stringify(freshEmployeeLink));
    assert.match(freshEmployeeLink.data.code, /^STAFFEV-/);
    const freshEmployeeAssignment = await m.EventAffiliate.findOne({ where: { eventId: futureEventId, userId: ids.adminRolePromoter } });
    assert.equal(freshEmployeeAssignment.status, 'active');
    assert.equal(freshEmployeeAssignment.orgAffiliateId, null, 'new staff referrals do not link to the inactive former-promoter organization affiliate');

    const allocation = await request(`/business/events/${futureEventId}/affiliates/${freshEmployeeAssignment.id}/guestlist-allocation`, 'owner', 'PATCH', { guestlistAllocation: 3 });
    assert.equal(allocation.status, 200, JSON.stringify(allocation));
    const employeePools = await request(`/business/events/${futureEventId}/guestlist-invite-pools`, 'adminRolePromoter');
    assert.equal(employeePools.status, 200, JSON.stringify(employeePools));
    assert.ok(employeePools.data.own.some((pool) => pool.id === freshEmployeeAssignment.id && pool.guestlistAllocation === 3));
    const guest = await m.User.findByPk(ids.guest);
    const employeeInvite = await request(`/business/events/${futureEventId}/guestlist-invitations`, 'adminRolePromoter', 'POST', {
      pool: 'own', eventAffiliateId: freshEmployeeAssignment.id, email: guest.email, partySize: 2,
    });
    assert.equal(employeeInvite.status, 201, JSON.stringify(employeeInvite));
    const invitedEntry = await m.GuestlistEntry.findByPk(employeeInvite.data.entryId);
    assert.equal(invitedEntry.eventAffiliateId, freshEmployeeAssignment.id, 'the active employee can invite from their allocated pool');
    assert.equal(invitedEntry.partySize, 2);

    const copyTargetResponse = await request('/business/events', 'owner', 'POST', futureEventInput('Copied future referral event', 'draft'));
    assert.equal(copyTargetResponse.status, 201, JSON.stringify(copyTargetResponse));
    const copyTargetId = copyTargetResponse.data.id;
    const copiedAccess = await request(`/business/events/${copyTargetId}/copy-access`, 'owner', 'POST', {
      sourceEventId: ids.event, copyTeam: true, copyAllocations: true,
    });
    assert.equal(copiedAccess.status, 200, JSON.stringify(copiedAccess));
    const [copiedManagerAssignment, copiedEmployeeAssignment] = await Promise.all([
      m.EventAffiliate.findOne({ where: { eventId: copyTargetId, userId: ids.owner } }),
      m.EventAffiliate.findOne({ where: { eventId: copyTargetId, userId: ids.adminRolePromoter } }),
    ]);
    assert.equal(copiedManagerAssignment.sourceOrgAffiliateId, ids.orgAffiliate,
      'copying an active detached manager referral retains its inactive former-promoter source');
    assert.equal(copiedManagerAssignment.orgAffiliateId, null);
    assert.equal(copiedManagerAssignment.guestlistAllocation, 10);
    assert.equal(copiedEmployeeAssignment.sourceOrgAffiliateId, ids.adminRoleOrgAffiliate,
      'copying an active detached employee referral retains its inactive former-promoter source');
    assert.equal(copiedEmployeeAssignment.orgAffiliateId, null);
    assert.equal(copiedEmployeeAssignment.guestlistAllocation, 7);
    const copyTarget = await m.Event.findByPk(copyTargetId);
    const publishedCopy = await request(`/business/events/${copyTargetId}`, 'owner', 'PUT', {
      ...futureEventInput('Copied future referral event', 'published'), version: copyTarget.version,
    });
    assert.equal(publishedCopy.status, 200, JSON.stringify(publishedCopy));

    const removedEmployee = await request(`/business/organizations/${ids.organization}/team/${ids.adminRolePromoter}`, 'owner', 'DELETE');
    assert.equal(removedEmployee.status, 200, JSON.stringify(removedEmployee));
    await Promise.all([freshEmployeeAssignment.reload(), copiedEmployeeAssignment.reload()]);
    assert.equal(freshEmployeeAssignment.status, 'inactive', 'removing the employee revokes the fresh event referral');
    assert.equal(copiedEmployeeAssignment.status, 'inactive', 'retained copy provenance lets team removal revoke copied referrals');
    assert.equal((await request(`/business/events/${futureEventId}/referral-link`, 'adminRolePromoter')).status, 403);
    assert.equal((await request(`/business/events/${copyTargetId}/referral-link`, 'adminRolePromoter')).status, 403);
    assert.equal((await request(`/business/events/${futureEventId}/referral-link`, 'rolePromoter')).status, 403,
      'a removed former promoter cannot acquire a link for a new future event');

    for (const scenario of rejoinCases) {
      const userId = ids[scenario.userKey];
      const [mainAssignment, otherEventAssignment, user] = await Promise.all([
        m.EventAffiliate.findByPk(ids[scenario.eventAffiliateKey]),
        m.EventAffiliate.findByPk(ids[scenario.otherEventAffiliateKey]),
        m.User.findByPk(userId),
      ]);
      const original = {
        id: mainAssignment.id, code: mainAssignment.code, commissionBps: mainAssignment.commissionBps,
        guestlistAllocation: mainAssignment.guestlistAllocation, startsAt: mainAssignment.startsAt.getTime(), endsAt: mainAssignment.endsAt.getTime(),
      };

      const removed = await request(`/business/organizations/${ids.organization}/team/${userId}`, 'owner', 'DELETE');
      assert.equal(removed.status, 200, JSON.stringify(removed));
      await Promise.all([mainAssignment.reload(), otherEventAssignment.reload()]);
      assert.equal(mainAssignment.status, 'inactive', `${scenario.removedRole} removal blocks existing org referral access`);
      assert.equal(otherEventAssignment.status, 'inactive', 'removal revokes organization scope in every same-org event');
      assert.equal((await request(`/business/events/${ids.event}/referral-link`, userId)).status, 403, 'reading while removed does not restore an assignment');
      const removedConnections = await request(`/customer/connections?eventId=${ids.event}&page=1&pageSize=9&personIds=${userId}`, 'buyer');
      assert.equal(removedConnections.status, 200, JSON.stringify(removedConnections));
      assert.equal(removedConnections.data.total, 0, 'the customer referrer picker excludes the explicitly removed person');
      await mainAssignment.reload();
      assert.equal(mainAssignment.status, 'inactive', 'GET leaves the organization assignment inactive');

      const invitation = await request(`/business/organizations/${ids.organization}/invitations`, 'owner', 'POST', { email: user.email, role: scenario.restoredRole });
      assert.equal(invitation.status, 201, JSON.stringify(invitation));
      const accepted = await request(`/team/invitations/${invitation.data.token}/accept`, userId, 'POST');
      assert.equal(accepted.status, 200, JSON.stringify(accepted));
      assert.equal(accepted.data.role, scenario.restoredRole);

      await Promise.all([mainAssignment.reload(), otherEventAssignment.reload()]);
      for (const assignment of [mainAssignment, otherEventAssignment]) {
        assert.equal(assignment.status, 'active', `${scenario.restoredRole} re-add restores organization-scoped assignment`);
        assert.equal(assignment.accessScope, 'organization');
        assert.equal(assignment.guestlistAllocation, assignment.id === mainAssignment.id ? original.guestlistAllocation : 4);
      }
      assert.deepEqual({ id: mainAssignment.id, code: mainAssignment.code, commissionBps: mainAssignment.commissionBps,
        guestlistAllocation: mainAssignment.guestlistAllocation, startsAt: mainAssignment.startsAt.getTime(), endsAt: mainAssignment.endsAt.getTime() }, original,
      're-add preserves the existing assignment id, code, terms, allocation, and windows');

      const restoredLink = await request(`/business/events/${ids.event}/referral-link`, userId);
      assert.equal(restoredLink.status, 200, JSON.stringify(restoredLink));
      assert.equal(restoredLink.data.code, original.code, 'the existing referral code remains usable after explicit re-add');
      assert.equal((await request(`/events/${ids.event}/referral-visits`, null, 'POST', { code: original.code })).status, 200);
      const restoredPools = await request(`/business/events/${ids.event}/guestlist-invite-pools`, userId);
      assert.equal(restoredPools.status, 200, JSON.stringify(restoredPools));
      assert.ok(restoredPools.data.own.some((pool) => pool.id === original.id && pool.guestlistAllocation === 6),
        'restored organization users regain their original own guestlist pool');
      if (scenario === rejoinCases[0]) {
        const availableInvitee = await m.User.findByPk(ids.rolePromoter);
        const restoredInvite = await request(`/business/events/${ids.event}/guestlist-invitations`, userId, 'POST', {
          pool: 'own', eventAffiliateId: original.id, email: availableInvitee.email, partySize: 2,
        });
        assert.equal(restoredInvite.status, 201, JSON.stringify(restoredInvite));
        const restoredEntry = await m.GuestlistEntry.findByPk(restoredInvite.data.entryId);
        assert.equal(restoredEntry.eventAffiliateId, original.id);
        assert.equal(restoredEntry.partySize, 2);
        const overAllocationInvitee = await m.User.findByPk(ids.promoter);
        const overAllocationInvite = await request(`/business/events/${ids.event}/guestlist-invitations`, userId, 'POST', {
          pool: 'own', eventAffiliateId: original.id, email: overAllocationInvitee.email, partySize: 3,
        });
        assert.equal(overAllocationInvite.status, 409, 'existing used capacity plus an over-allocation invite remains rejected after re-add');

        const historicalGuestlist = await m.GuestlistEntry.findByPk(ids.rejoinGuestlist);
        assert.equal(historicalGuestlist.eventAffiliateId, original.id, 're-add preserves historical guestlist attribution and used capacity');
        assert.equal(historicalGuestlist.partySize, 2);
        assert.equal(historicalGuestlist.status, 'confirmed');
      }
      const [restoredConnections, historicalOrder] = await Promise.all([
        request(`/customer/connections?eventId=${ids.event}&page=1&pageSize=9&personIds=${userId}`, 'buyer'),
        m.Order.findByPk(ids[scenario.orderKey]),
      ]);
      assert.equal(restoredConnections.status, 200, JSON.stringify(restoredConnections));
      assert.equal(restoredConnections.data.total, 1, 'the customer referrer picker restores the selected referrer after explicit re-add');
      assert.equal(restoredConnections.data.items[0].referrer.id, userId);
      assert.equal(historicalOrder.eventAffiliateId, original.id, 're-add preserves the referral snapshot on historical orders');
      assert.equal(historicalOrder.affiliateCommissionCents, scenario.commissionSnapshot);
    }

    const eventOnlyOtherAssignmentId = randomUUID();
    const eventOnlyOtherAssignment = await m.EventAffiliate.create({ id: eventOnlyOtherAssignmentId, eventId: futureEventId, userId: ids.rolePromoter,
      sourceOrgAffiliateId: ids.roleOrgAffiliate, code: `STAFFEV-REVOKED-${eventOnlyOtherAssignmentId.slice(0, 8)}`,
      commissionBps: 900, guestlistAllocation: 8, status: 'inactive', accessScope: 'organization' });
    assert.equal((await request(`/business/events/${futureEventId}/referral-link`, 'rolePromoter')).status, 403);
    const eventOnlyInvite = await request(`/business/events/${ids.event}/invitations`, 'owner', 'POST', {
      email: (await m.User.findByPk(ids.rolePromoter)).email, commissionBps: 0,
    });
    assert.equal(eventOnlyInvite.status, 201, JSON.stringify(eventOnlyInvite));
    const eventOnlyAcceptance = await request(`/team/invitations/${eventOnlyInvite.data.token}/accept`, 'rolePromoter', 'POST');
    assert.equal(eventOnlyAcceptance.status, 200, JSON.stringify(eventOnlyAcceptance));
    await revokedConvertedAssignment.reload();
    await retainedIndependentAssignment.reload();
    assert.equal(revokedConvertedAssignment.id, ids.roleEventAffiliate);
    assert.equal(revokedConvertedAssignment.status, 'active');
    assert.equal(revokedConvertedAssignment.accessScope, 'event');
    assert.equal(revokedConvertedAssignment.orgAffiliateId, null);
    assert.equal(revokedConvertedAssignment.sourceOrgAffiliateId, null);
    assert.equal(revokedConvertedAssignment.code, roleAssignment.code, 'event-only re-invitation preserves the target assignment and code');
    assert.equal(revokedConvertedAssignment.guestlistAllocation, 8, 'event-only re-invitation preserves the target allocation');
    assert.equal(retainedIndependentAssignment.status, 'active', 'event-only re-invitation does not alter another event assignment');
    await eventOnlyOtherAssignment.reload();
    assert.equal(eventOnlyOtherAssignment.status, 'inactive', 'event-only re-invitation does not restore another revoked organization-scoped event assignment');
    assert.equal(eventOnlyOtherAssignment.accessScope, 'organization');
    assert.equal((await request(`/business/events/${futureEventId}/referral-link`, 'rolePromoter')).status, 403);
    assert.equal((await m.OrgAffiliate.findByPk(ids.roleOrgAffiliate)).status, 'inactive', 'event-only re-invitation does not restore organization membership or affiliate access');
    assert.equal((await request(`/business/events/${ids.event}/referral-link`, 'rolePromoter')).status, 200);
    assert.equal((await request(`/business/events/${ids.secondaryEvent}/referral-link`, 'rolePromoter')).status, 200,
      'the existing independent event grant remains available without restoring organization membership');

    const independentCreatorEventResponse = await request('/business/events', 'rolePromoter', 'POST', {
      ...futureEventInput('Independent creator rejoin fixture', 'published'), organizationId: null, locationId: null,
      location: { name: 'Independent Rejoin Room', addressLine1: '9 Test Way', city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
    });
    assert.equal(independentCreatorEventResponse.status, 201, JSON.stringify(independentCreatorEventResponse));
    const independentCreatorEventId = independentCreatorEventResponse.data.id;
    const independentCreatorLink = await request(`/business/events/${independentCreatorEventId}/referral-link`, 'rolePromoter');
    assert.equal(independentCreatorLink.status, 200, JSON.stringify(independentCreatorLink));
    const independentCreatorAssignment = await m.EventAffiliate.findOne({ where: { eventId: independentCreatorEventId, userId: ids.rolePromoter } });
    const independentCreatorCode = independentCreatorAssignment.code;
    assert.equal(independentCreatorAssignment.accessScope, 'event');
    const independentCreatorRemoval = await request(`/business/events/${independentCreatorEventId}/people`, 'rolePromoter', 'PUT', {
      userId: ids.rolePromoter, commissionBps: independentCreatorAssignment.commissionBps, status: 'inactive',
    });
    assert.equal(independentCreatorRemoval.status, 200, JSON.stringify(independentCreatorRemoval));
    assert.equal((await request(`/business/events/${independentCreatorEventId}/referral-link`, 'rolePromoter')).status, 403,
      'independent creator event removal denies access until an explicit restoration');
    const independentCreatorInvite = await request(`/business/events/${independentCreatorEventId}/invitations`, 'rolePromoter', 'POST', {
      email: (await m.User.findByPk(ids.rolePromoter)).email, commissionBps: 0,
    });
    assert.equal(independentCreatorInvite.status, 201, JSON.stringify(independentCreatorInvite));
    const independentCreatorAcceptance = await request(`/team/invitations/${independentCreatorInvite.data.token}/accept`, 'rolePromoter', 'POST');
    assert.equal(independentCreatorAcceptance.status, 200, JSON.stringify(independentCreatorAcceptance));
    await independentCreatorAssignment.reload();
    assert.equal(independentCreatorAssignment.status, 'active');
    assert.equal(independentCreatorAssignment.accessScope, 'event');
    assert.equal(independentCreatorAssignment.code, independentCreatorCode);
    assert.equal(independentCreatorAssignment.orgAffiliateId, null);
    assert.equal(independentCreatorAssignment.sourceOrgAffiliateId, null);
    assert.equal((await request(`/business/events/${independentCreatorEventId}/referral-link`, 'rolePromoter')).status, 200);

    const adminRoleUser = await m.User.findByPk(ids.adminRolePromoter);
    const adminRestore = await request(`/admin/management/users/${ids.adminRolePromoter}/scoped-role`, 'internalAdmin', 'POST', {
      organizationId: ids.organization, role: 'employee', reason: 'Restore removed staff access for regression coverage', version: adminRoleUser.version,
    });
    assert.equal(adminRestore.status, 200, JSON.stringify(adminRestore));
    await Promise.all([freshEmployeeAssignment.reload(), copiedEmployeeAssignment.reload()]);
    assert.equal(freshEmployeeAssignment.status, 'active', 'admin scoped-role restoration reactivates the fresh org assignment');
    assert.equal(copiedEmployeeAssignment.status, 'active', 'admin scoped-role restoration reactivates the copied org assignment');
    assert.equal(freshEmployeeAssignment.accessScope, 'organization');
    assert.equal(copiedEmployeeAssignment.accessScope, 'organization');
    assert.equal(freshEmployeeAssignment.guestlistAllocation, 3);
    assert.equal(copiedEmployeeAssignment.guestlistAllocation, 7);
    assert.equal((await request(`/business/events/${futureEventId}/referral-link`, 'adminRolePromoter')).data.code, freshEmployeeLink.data.code);
    assert.equal((await request(`/business/events/${copyTargetId}/referral-link`, 'adminRolePromoter')).data.code, copiedEmployeeAssignment.code);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  }
});
