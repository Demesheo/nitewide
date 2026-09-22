const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionService } = require('../src/services/permission-service');

function modelsFor({ eventAffiliate = null, leaderRole = null, employee = null } = {}) {
  return {
    Event: { findByPk: async () => ({ id: 'event-1', creatorUserId: 'creator-1', organizationId: 'org-1' }) },
    User: { findByPk: async () => ({ id: 'user-1', isActive: true, isInternalAdmin: false }) },
    OrganizationOwner: { findOne: async () => leaderRole ? { userId: 'user-1', role: leaderRole } : null },
    EventAffiliate: { findAll: async () => eventAffiliate ? [eventAffiliate] : [] },
    OrgAffiliate: { findOne: async () => null },
    OrganizationEmployee: { findOne: async () => employee },
  };
}

test('a selected event referrer can review only their own attributed entries', async () => {
  const permissions = createPermissionService(modelsFor({ eventAffiliate: { id: 'affiliate-1', status: 'active' } }));
  const scope = await permissions.guestlistReviewScope('user-1', 'event-1');
  assert.equal(scope.event.id, 'event-1');
  assert.equal(scope.canReviewAny, false);
  assert.deepEqual(scope.eventAffiliateIds, ['affiliate-1']);
});

test('an unrelated customer may not review guestlist requests', async () => {
  const permissions = createPermissionService(modelsFor());
  await assert.rejects(() => permissions.assertGuestlistApprover('user-1', 'event-1'), (error) => error.code === 'FORBIDDEN');
});
test('employees without a selected referral cannot review direct or another referrer’s guestlist', async () => {
  const permissions = createPermissionService(modelsFor({ employee: { id: 'employee-1', status: 'active' } }));
  await assert.rejects(() => permissions.guestlistReviewScope('user-1', 'event-1'), (error) => error.code === 'FORBIDDEN');
  await assert.rejects(() => permissions.assertManageOrganization('user-1', 'org-1'), (error) => error.code === 'FORBIDDEN');
});

test('owners and managers can review direct and all referred guestlist entries', async () => {
  for (const role of ['owner', 'admin']) {
    const permissions = createPermissionService(modelsFor({ leaderRole: role }));
    const scope = await permissions.guestlistReviewScope('user-1', 'event-1');
    assert.equal(scope.canReviewAny, true);
  }
});

test('automatic employee referrals allow only own approvals and stop when employment ends', async () => {
  const assignment = { id:'staff-event', code:'STAFFEV-fixture', status:'active' };
  const active = createPermissionService(modelsFor({eventAffiliate:assignment,employee:{status:'active'}}));
  assert.deepEqual((await active.guestlistReviewScope('user-1','event-1')).eventAffiliateIds,['staff-event']);
  assert.equal((await active.guestlistReviewScope('user-1','event-1')).canReviewAny,false);
  const former = createPermissionService(modelsFor({eventAffiliate:assignment}));
  await assert.rejects(former.guestlistReviewScope('user-1','event-1'),{code:'FORBIDDEN'});
});

test('a former venue leader cannot use an automatic referral record to regain guestlist approval access', async () => {
  const permissions = createPermissionService(modelsFor({eventAffiliate:{id:'leader-event',code:'LEADEV-fixture',status:'active'}}));
  await assert.rejects(permissions.guestlistReviewScope('user-1','event-1'),{code:'FORBIDDEN'});
});
