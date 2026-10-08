const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeamService } = require('../src/services/team-service');
const { forbidden } = require('../src/domain/errors');

test('team reads separate owner finance grants from operational roles and internal staff', async () => {
  const leaders = [
    { userId: 'owner', role: 'owner', lifecycleState: 'active', user: { displayName: 'Owner' } },
    { userId: 'manager', role: 'admin', lifecycleState: 'active', financeAuthorized: true, user: { displayName: 'Manager' } },
  ];
  const models = { Organization: { findByPk: async () => ({ id: 'org', version: 7 }) },
    OrganizationOwner: { findAll: async () => leaders }, OrganizationEmployee: { findAll: async () => [] },
    OrgAffiliate: { findAll: async () => [] }, TeamInvitation: { findAll: async () => [] }, User: {} };
  const service = createTeamService({ models, permissions: { assertManageOrganization: async () => {} } });
  for (const id of ['owner', 'manager', 'platform-admin']) {
    const roster = await service.roster(id, 'org');
    assert.equal(roster.canGrantFinance, id === 'owner'); assert.equal(roster.organizationVersion, 7);
    assert.equal(roster.people.find((row) => row.id === 'manager').financeAuthorized, true);
  }
});

test('managers can invite managers, employees, and promoters within their organizations', async () => {
  const writes = [];
  const models = {
    Organization: { findByPk: async () => ({ name: 'Venue', status: 'active' }) },
    TeamInvitation: { sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) }, create: async (input) => { writes.push(input); return { ...input, id: 'invite' }; } },
    AuditLog: { create: async () => {} },
  };
  const permissions = { assertManageOrganization: async () => {}, assertOwnOrganization: async () => { throw forbidden('Owner only'); } };
  const service = createTeamService({ models, permissions });
  const invitedManager = await service.invite('manager', 'org', { email: 'A@Example.com', role: 'manager' });
  assert.equal(invitedManager.role, 'manager');
  assert.equal(writes.length, 1);
  const employee = await service.invite('manager', 'org', { email: 'B@Example.com', name: '  Invited Employee  ', phone: '+14075550123', role: 'employee' });
  assert.equal(employee.email, 'b@example.com');
  assert.equal(employee.phone, '+14075550123');
  assert.equal(writes[1].phone, '+14075550123');
  assert.equal(employee.name, 'Invited Employee');
  assert.equal(writes[1].name, employee.name);
  assert.equal(writes.length, 2);
  await service.invite('manager', 'org', { email: 'C@Example.com', role: 'affiliate' });
  assert.equal(writes.length, 3);
});

test('accepting an employee invitation adds staff access, not manager access, to an existing customer', async () => {
  const writes = [];
  let pendingReads = 0;
  const membershipReads = [];
  const readMembership = (kind) => async ({ transaction }) => {
    assert.ok(transaction, 'membership checks retain their invitation transaction');
    assert.equal(pendingReads, 0, 'membership queries must not overlap on one PostgreSQL transaction client');
    pendingReads += 1;
    try {
      await Promise.resolve();
      membershipReads.push(kind);
      return null;
    } finally { pendingReads -= 1; }
  };
  const row = { role: 'employee', email: 'customer@example.com', organizationId: 'org', expiresAt: new Date(Date.now() + 60000), update: async (values) => writes.push(['accepted', values]) };
  const models = {
    Organization: { findByPk: async () => ({ id: 'org', status: 'active' }) },
    Event: { findAll: async () => [] },
    TeamInvitation: { sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: true } }) }, findOne: async () => row },
    User: { findByPk: async () => ({ id: 'customer', email: 'customer@example.com' }) },
    OrganizationEmployee: { findOne: readMembership('employee'), create: async (values) => writes.push(['employee', values]) },
    OrganizationOwner: { findOne: readMembership('owner'), unscoped() { return this; }, create: async () => writes.push(['manager']) },
    OrgAffiliate: { findOne: readMembership('affiliate') },
    EventAffiliate: { findAll: async () => [] },
    AuditLog: { create: async () => {} },
  };
  const service = createTeamService({ models, permissions: { assertManageOrganization: async () => ({}) } });
  assert.deepEqual(await service.accept('customer', 'private-token'), { organizationId: 'org', role: 'employee' });
  assert.deepEqual(membershipReads, ['owner', 'employee', 'affiliate']);
  assert.equal(writes[0][0], 'employee');
  assert.equal(writes.some((entry) => entry[0] === 'manager'), false);
});

test('an invitation cannot be accepted from a different customer email', async () => {
  const row = { role: 'employee', email: 'invited@example.com', organizationId: 'org', expiresAt: new Date(Date.now() + 60000) };
  const models = {
    Organization: { findByPk: async () => ({ id: 'org', status: 'active' }) },
    TeamInvitation: { sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: true } }) }, findOne: async () => row },
    User: { findByPk: async () => ({ id: 'other', email: 'other@example.com' }) },
  };
  await assert.rejects(() => createTeamService({ models, permissions: {} }).accept('other', 'private-token'), { code: 'FORBIDDEN' });
});

test('event promoter invitations keep their optional contact phone on renewal', async () => {
  const event = { id: 'event-1', title: 'Friday Night', organizationId: 'org-1', status: 'published', endsAt: new Date(Date.now() + 86400000) };
  const saved = [];
  let pending = null;
  const models = {
    Event: { findByPk: async () => event },
    TeamInvitation: {
      sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: true } }) },
      findOne: async () => pending,
      create: async (values) => { pending = { id: 'invite-1', ...values, update: async (updates) => Object.assign(pending, updates) }; saved.push(values); return pending; },
    },
    AuditLog: { create: async () => {} },
  };
  const service = createTeamService({ models, permissions: { assertManageEvent: async () => {} } });
  await assert.rejects(service.inviteEvent('owner', event.id, { email: 'promoter@example.com', phone: '+14075550123', commissionBps: 500 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  assert.equal(saved.length, 0);
  await service.inviteEvent('owner', event.id, { email: 'promoter@example.com', phone: '+14075550123', commissionBps: 0 });
  const renewed = await service.inviteEvent('owner', event.id, { email: 'promoter@example.com', phone: '+14075550123', commissionBps: 0 });
  assert.equal(saved.length, 1);
  assert.equal(renewed.phone, '+14075550123');
  assert.equal(pending.phone, '+14075550123');
});

function financeFixture({ lifecycleState = 'active', role = 'admin' } = {}) {
  const membership = { id: 'membership', userId: 'member', role, lifecycleState, financeAuthorized: true, update: async function update(changes) { Object.assign(this, changes); return this; } };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { transaction: async (...args) => args.at(-1)(transaction) };
  const invitation = { id: 'invitation', role: 'manager', email: 'member@example.test', organizationId: 'organization', invitedByUserId: 'actor', expiresAt: new Date(Date.now() + 60000), update: async function update(changes) { Object.assign(this, changes); } };
  const models = {
    Organization: { sequelize, findByPk: async () => ({ id: 'organization', name: 'Fixture Business', status: 'active' }) },
    OrganizationOwner: { unscoped() { return this; }, findOne: async () => membership },
    OrganizationEmployee: { findOne: async () => null, create: async () => ({}) },
    OrgAffiliate: { findOne: async () => null, create: async () => ({}) },
    Event: { findAll: async () => [] },
    EventAffiliate: { findAll: async () => [] },
    User: { findByPk: async (id) => ({ id, email: 'member@example.test', isActive: true }) },
    TeamInvitation: { sequelize, findOne: async () => invitation },
    AuditLog: { create: async () => ({ id: 'audit' }) },
  };
  return { membership, service: createTeamService({ models, permissions: { assertManageOrganization: async () => {} } }) };
}
test('business role changes revoke manager finance before demotion or removal', async () => {
  for (const role of ['employee', 'affiliate']) {
    const { membership, service } = financeFixture();
    await service.changeRole('actor', 'organization', 'member', role);
    assert.equal(membership.financeAuthorized, false);
    assert.equal(membership.lifecycleState, 'archived');
  }
  const { membership, service } = financeFixture();
  await service.removeMember('actor', 'organization', 'member');
  assert.equal(membership.financeAuthorized, false);
});
test('reinstating a manager through a role change or acceptance cannot resurrect an old finance grant', async () => {
  const changed = financeFixture({ lifecycleState: 'archived' });
  await changed.service.changeRole('actor', 'organization', 'member', 'manager');
  assert.equal(changed.membership.financeAuthorized, false);
  const accepted = financeFixture({ lifecycleState: 'archived' });
  await accepted.service.accept('member', 'known-invitation');
  assert.equal(accepted.membership.financeAuthorized, false);
  const active = financeFixture();
  await active.service.changeRole('actor', 'organization', 'member', 'manager');
  assert.equal(active.membership.financeAuthorized, true, 'an unchanged active manager keeps an explicit grant');
});

test('event invitation commission terms cannot be prepared or activated for an infeasible absorbed offering', async () => {
  let assignmentWrites = 0; let invitationWrites = 0;
  const sequelize = { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }), query: async () => [{ eventFeeMode: 'absorbed', feeMode: 'inherit', name: 'Below minimum', priceCents: 500, currency: 'USD', minPerOrder: 1, maxPerOrder: 2, isActive: true }] };
  const event = { id: 'event', status: 'published', endsAt: new Date(Date.now() + 86400000) };
  const invitation = { id: 'invitation', eventId: event.id, invitedByUserId: 'actor', email: 'member@example.test', role: 'affiliate', commissionBps: 500, expiresAt: new Date(Date.now() + 60000), update: async () => { invitationWrites += 1; } };
  const models = {
    Event: { sequelize, findByPk: async () => event }, Offering: {},
    User: { findByPk: async (id) => ({ id, email: invitation.email, isActive: true }) },
    TeamInvitation: { sequelize, findOne: async () => invitation, create: async () => { invitationWrites += 1; } },
    EventAffiliate: { findOrCreate: async () => { assignmentWrites += 1; } },
  };
  const service = createTeamService({ models, permissions: { assertManageEvent: async () => {} } });
  await assert.rejects(service.inviteEvent('actor', event.id, { email: invitation.email, commissionBps: 500 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  await assert.rejects(service.accept('member', 'known-hashed-invitation'), { code: 'PRICING_EDITOR_INVALID' });
  assert.equal(invitationWrites, 0); assert.equal(assignmentWrites, 0);
});

test('legacy invitation preview and acceptance preserve configured terms while showing effective zero', async () => {
  const event = { id: 'event', title: 'Legacy invitation event', status: 'published', endsAt: new Date(Date.now() + 86400000) };
  const invitation = { id: 'invitation', eventId: event.id, event, email: 'recipient@example.test', role: 'affiliate',
    invitedByUserId: 'actor', commissionBps: 1500, expiresAt: new Date(Date.now() + 60000),
    async update(values) { Object.assign(this, values); } };
  let createdAssignment;
  let recipient = { id: 'recipient' };
  let activeInvitation = invitation;
  let recipientLookups = 0;
  const models = {
    Event: { findByPk: async () => event },
    User: { findByPk: async (id) => ({ id, email: invitation.email, isActive: true }), findOne: async ({ where, attributes }) => {
      assert.deepEqual(where, { email: invitation.email }); assert.deepEqual(attributes, ['id']); recipientLookups++; return recipient;
    } },
    TeamInvitation: { sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) },
      findOne: async () => activeInvitation, findAll: async () => [invitation] },
    EventAffiliate: { findOrCreate: async ({ where, defaults }) => {
      createdAssignment = { id: 'assignment', ...where, ...defaults, toJSON() { return { id: this.id, commissionBps: this.commissionBps }; } };
      return [createdAssignment, true];
    } }, AuditLog: { create: async () => ({}) },
  };
  const service = createTeamService({ models, permissions: { assertManageEvent: async () => {} } });
  assert.equal((await service.invitation('legacy-link')).accountMode, 'existing');
  recipient = null;
  assert.equal((await service.invitation('legacy-link')).accountMode, 'new');
  activeInvitation = null;
  await assert.rejects(service.invitation('invalid-link'), { code: 'NOT_FOUND' });
  assert.equal(recipientLookups, 2, 'invalid links never query whether an email has an account');
  activeInvitation = invitation;
  for (const preview of [await service.invitation('legacy-link'), ...(await service.eventInvitations('actor', event.id))]) {
    assert.equal(preview.commissionBps, 0);
    assert.equal(preview.configuredCommissionBps, 1500);
    assert.equal(preview.commissionEligibility.eligible, false);
  }
  assert.deepEqual(await service.accept('recipient', 'legacy-link'), { eventId: event.id, role: 'affiliate' });
  assert.equal(createdAssignment.commissionBps, 1500, 'accepting access does not silently rewrite legacy configured terms');
  assert.equal(invitation.commissionBps, 1500);
  assert.ok(invitation.acceptedAt);
});
