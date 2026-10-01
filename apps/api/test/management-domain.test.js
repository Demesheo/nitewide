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
