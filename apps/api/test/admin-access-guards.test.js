const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUserAccessChange } = require('../src/services/admin-access-guards');

const USER = '20000000-0000-4000-8000-000000000002';

test('self admin lockout is refused by the shared guard before membership reads', async () => {
  let lookedUp = false;
  await assert.rejects(() => assertUserAccessChange({
    models: { OrganizationOwner: { findAll: async () => { lookedUp = true; return []; } } },
    actorUserId: USER,
    user: { id: USER, isInternalAdmin: true, isActive: true },
    changes: { isActive: false },
  }), { code: 'SELF_ADMIN_LOCKOUT' });
  assert.equal(lookedUp, false);
});

test('the last active internal administrator cannot be disabled through any caller', async () => {
  await assert.rejects(() => assertUserAccessChange({
    models: {
      User: { count: async () => 1 },
      OrganizationOwner: { findAll: async () => [] },
    },
    actorUserId: 'admin-actor',
    user: { id: USER, isInternalAdmin: true, isActive: true },
    changes: { isInternalAdmin: false },
  }), { code: 'LAST_ADMIN' });
});

test('sole active owner of an active organization cannot be deactivated', async () => {
  let ownerLookups = 0;
  const models = {
    OrganizationOwner: {
      findAll: async ({ where }) => {
        ownerLookups += 1;
        if (ownerLookups === 1) return [{ organizationId: 'org-1', role: 'owner' }];
        assert.equal(where.organizationId, 'org-1');
        return [];
      },
    },
    Organization: { findByPk: async () => ({ id: 'org-1', status: 'active', name: 'Only Owner Venue' }) },
    User: { count: async () => 0 },
  };
  await assert.rejects(() => assertUserAccessChange({
    models,
    actorUserId: 'admin-actor',
    user: { id: USER, isInternalAdmin: false, isActive: true },
    changes: { isActive: false },
  }), { code: 'LAST_ORGANIZATION_OWNER' });
});

test('another active organization owner permits the access change, but inactive organizations do not block it', async () => {
  const cases = [
    { status: 'active', otherActiveOwners: 1 },
    { status: 'closed', otherActiveOwners: 0 },
  ];
  for (const scenario of cases) {
    let ownerLookups = 0;
    const models = {
      OrganizationOwner: { findAll: async () => ++ownerLookups === 1 ? [{ organizationId: 'org-1' }] : [{ userId: 'other-owner' }] },
      Organization: { findByPk: async () => ({ id: 'org-1', name: 'Venue', status: scenario.status }) },
      User: { count: async () => scenario.otherActiveOwners },
    };
    await assert.doesNotReject(() => assertUserAccessChange({
      models,
      actorUserId: 'admin-actor',
      user: { id: USER, isInternalAdmin: false, isActive: true },
      changes: { isActive: false },
    }));
  }
});

test('lifecycle suspension applies the same last-owner guard as account deactivation', async () => {
  const models = {
    OrganizationOwner: { findAll: async ({ where }) => where.userId === USER ? [{ organizationId: 'org-1' }] : [] },
    Organization: { findByPk: async () => ({ id: 'org-1', status: 'active', name: 'Owner Workspace' }) },
    User: { count: async () => 0 },
  };
  await assert.rejects(assertUserAccessChange({ models, actorUserId: 'admin-actor', user: { id: USER, isActive: true }, changes: { lifecycleState: 'suspended' } }), { code: 'LAST_ORGANIZATION_OWNER' });
});

test('last platform owner cannot be downgraded while ordinary internal staff still exist', async () => {
  let query;
  const models = { User: { rawAttributes: { internalAdminRole: {}, lifecycleState: {} }, count: async (options) => { query = options.where; return 1; } } };
  await assert.rejects(assertUserAccessChange({ models, actorUserId: 'different-admin', user: { id: USER, isActive: true, isInternalAdmin: true, internalAdminRole: 'platform_owner' }, changes: { internalAdminRole: 'read_only' } }), { code: 'LAST_ADMIN' });
  assert.equal(query.isInternalAdmin, true);
  assert.ok(Object.getOwnPropertySymbols(query).length);
});

test('an already inactive platform administrator can be downgraded without counting as the last active one', async () => {
  const models = { User: { count: async () => { throw new Error('Inactive source must not query active administrator loss'); } } };
  await assert.doesNotReject(assertUserAccessChange({ models, actorUserId: 'different-admin', user: { id: USER, isActive: true, isInternalAdmin: true, lifecycleState: 'suspended' }, changes: { internalAdminRole: 'read_only' } }));
});
