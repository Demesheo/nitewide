const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionService } = require('../src/services/permission-service');

function modelsFor({ orgAffiliate = null, eventAffiliate = null } = {}) {
  return {
    Event: { findByPk: async () => ({ id: 'event-1', creatorUserId: 'creator-1', organizationId: 'org-1' }) },
    User: { findByPk: async () => ({ id: 'user-1', isInternalAdmin: false }) },
    OrganizationOwner: { findOne: async () => null },
    EventAffiliate: { findOne: async () => eventAffiliate },
    OrgAffiliate: { findOne: async () => orgAffiliate },
  };
}

test('an active organization employee or promoter may review guestlist requests', async () => {
  const permissions = createPermissionService(modelsFor({ orgAffiliate: { id: 'affiliate-1', status: 'active' } }));
  const event = await permissions.assertGuestlistApprover('user-1', 'event-1');
  assert.equal(event.id, 'event-1');
});

test('an unrelated customer may not review guestlist requests', async () => {
  const permissions = createPermissionService(modelsFor());
  await assert.rejects(() => permissions.assertGuestlistApprover('user-1', 'event-1'), (error) => error.code === 'FORBIDDEN');
});
