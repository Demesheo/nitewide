const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeamService } = require('../src/services/team-service');
const { forbidden } = require('../src/domain/errors');

test('only owners can invite a manager; managers can invite employees and promoters', async () => {
  const writes = [];
  const models = {
    Organization: { findByPk: async () => ({ name: 'Venue' }) },
    TeamInvitation: { create: async (input) => { writes.push(input); return { id: 'invite', expiresAt: input.expiresAt }; } },
    AuditLog: { create: async () => {} },
  };
  const permissions = { assertManageOrganization: async () => {}, assertOwnOrganization: async () => { throw forbidden('Owner only'); } };
  const service = createTeamService({ models, permissions });
  await assert.rejects(() => service.invite('manager', 'org', { email: 'A@Example.com', role: 'manager' }), { code: 'FORBIDDEN' });
  assert.equal(writes.length, 0);
  const employee = await service.invite('manager', 'org', { email: 'A@Example.com', role: 'employee' });
  assert.equal(employee.email, 'a@example.com');
  assert.equal(writes.length, 1);
  await service.invite('manager', 'org', { email: 'B@Example.com', role: 'affiliate' });
  assert.equal(writes.length, 2);
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
