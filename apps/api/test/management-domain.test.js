const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementService } = require('../src/services/management-service');

test('legacy guestlist settings aggregate every pool in one query and preserve unused zeroes', async () => {
  let calls = 0;
  const models = {
    GuestlistEntry: { findAll: async (options) => {
      calls += 1;
      assert.equal(options.where.eventId, 'event-fixture');
      assert.deepEqual(options.group, ['eventAffiliateId']);
      assert.deepEqual(options.where.status, ['confirmed', 'checked_in']);
      return [{ eventAffiliateId: null, used: '3' }, { eventAffiliateId: 'pool-one', used: '7' }];
    } },
    EventAffiliate: { findAll: async () => [
      { id: 'pool-one', guestlistAllocation: null, orgAffiliate: { defaultGuestlistAllocation: 10 } },
      { id: 'pool-two', guestlistAllocation: 5 },
    ] },
  };
  const service = createManagementService({ models, permissions: { assertManageEvent: async () => ({ id: 'event-fixture', title: 'Fixture', guestlistCapacity: 20 }) } });
  const result = await service.guestlistSettings('actor', { eventId: 'event-fixture' });
  assert.equal(calls, 1);
  assert.equal(result.direct.used, 3);
  assert.deepEqual(result.promoters.map((pool) => [pool.used, pool.effectiveGuestlistAllocation]), [[7, 10], [0, 5]]);
});

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
