const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeamService } = require('../src/services/team-service');
const { forbidden } = require('../src/domain/errors');

test('managers can invite managers, employees, and promoters within their organizations', async () => {
  const writes = [];
  const models = {
    Organization: { findByPk: async () => ({ name: 'Venue' }) },
    TeamInvitation: { create: async (input) => { writes.push(input); return { ...input, id: 'invite' }; } },
    AuditLog: { create: async () => {} },
  };
  const permissions = { assertManageOrganization: async () => {}, assertOwnOrganization: async () => { throw forbidden('Owner only'); } };
  const service = createTeamService({ models, permissions });
  const invitedManager = await service.invite('manager', 'org', { email: 'A@Example.com', role: 'manager' });
  assert.equal(invitedManager.role, 'manager');
  assert.equal(writes.length, 1);
  const employee = await service.invite('manager', 'org', { email: 'B@Example.com', phone: '+14075550123', role: 'employee' });
  assert.equal(employee.email, 'b@example.com');
  assert.equal(employee.phone, '+14075550123');
  assert.equal(writes[1].phone, '+14075550123');
  assert.equal(writes.length, 2);
  await service.invite('manager', 'org', { email: 'C@Example.com', role: 'affiliate' });
  assert.equal(writes.length, 3);
});

test('accepting an employee invitation adds staff access, not manager access, to an existing customer', async () => {
  const writes = [];
  const row = { role: 'employee', email: 'customer@example.com', organizationId: 'org', expiresAt: new Date(Date.now() + 60000), update: async (values) => writes.push(['accepted', values]) };
  const models = {
    TeamInvitation: { sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: true } }) }, findOne: async () => row },
    User: { findByPk: async () => ({ id: 'customer', email: 'customer@example.com' }) },
    OrganizationEmployee: { findOne: async () => null, create: async (values) => writes.push(['employee', values]) },
    OrganizationOwner: { findOne: async () => null, create: async () => writes.push(['manager']) },
    AuditLog: { create: async () => {} },
  };
  const service = createTeamService({ models, permissions: {} });
  assert.deepEqual(await service.accept('customer', 'private-token'), { organizationId: 'org', role: 'employee' });
  assert.equal(writes[0][0], 'employee');
  assert.equal(writes.some((entry) => entry[0] === 'manager'), false);
});

test('an invitation cannot be accepted from a different customer email', async () => {
  const row = { role: 'employee', email: 'invited@example.com', organizationId: 'org', expiresAt: new Date(Date.now() + 60000) };
  const models = {
    TeamInvitation: { sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: true } }) }, findOne: async () => row },
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
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: true } }) },
      findOne: async () => pending,
      create: async (values) => { pending = { id: 'invite-1', ...values, update: async (updates) => Object.assign(pending, updates) }; saved.push(values); return pending; },
    },
    AuditLog: { create: async () => {} },
  };
  const service = createTeamService({ models, permissions: { assertManageEvent: async () => {} } });
  await service.inviteEvent('owner', event.id, { email: 'promoter@example.com', phone: '+14075550123', commissionBps: 500 });
  const renewed = await service.inviteEvent('owner', event.id, { email: 'promoter@example.com', phone: '+14075550123', commissionBps: 500 });
  assert.equal(saved.length, 1);
  assert.equal(renewed.phone, '+14075550123');
  assert.equal(pending.phone, '+14075550123');
});
