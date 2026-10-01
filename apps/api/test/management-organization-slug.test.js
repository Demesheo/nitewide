const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementService } = require('../src/services/management-service');

test('legacy organization creation always generates distinct safe slugs and preserves existing identities', async () => {
  const rows = [{ id: 'existing', name: 'Same Name', slug: 'existing-stored-slug' }];
  const models = { User: { findByPk: async () => ({ isActive: true, lifecycleState: 'active' }) },
    Organization: { sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) },
      create: async (values) => { const row = { id: rows.length, ...values, toJSON() { return { ...this }; } }; rows.push(row); return row; } },
    OrganizationOwner: { create: async () => {} }, AuditLog: { create: async () => {} } };
  const service = createManagementService({ models, permissions: { assertInternal: async () => {} } });
  const first = await service.createOrganization('user', {}, { name: 'Same Name', slug: 'client-override' });
  const second = await service.createOrganization('user', {}, { name: 'Same Name' });
  assert.match(first.slug, /^same-name-[a-f0-9-]{36}$/); assert.notEqual(first.slug, second.slug);
  const unsafe = await service.createOrganization('user', {}, { name: '<script>../../東京🎉', slug: 'another-override' });
  assert.match(unsafe.slug, /^script-[a-f0-9-]{36}$/);
  assert.equal(rows[0].slug, 'existing-stored-slug');
});
