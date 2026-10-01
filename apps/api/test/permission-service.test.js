const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionService } = require('../src/services/permission-service');

function modelsFor({ eventAffiliate = null, leaderRole = null, employee = null, financeAuthorized = false, internalAdminRole = null } = {}) {
  return {
    Event: { findByPk: async () => ({ id: 'event-1', creatorUserId: 'creator-1', organizationId: 'org-1' }) },
    Organization: { findByPk: async () => ({ id: 'org-1', status: 'active' }) },
    User: { findByPk: async () => ({ id: 'user-1', isActive: true, isInternalAdmin: Boolean(internalAdminRole), internalAdminRole }) },
    OrganizationOwner: { findOne: async () => leaderRole ? { userId: 'user-1', role: leaderRole, financeAuthorized } : null },
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

test('finance permission belongs to owners and explicitly selected managers', async () => {
  for (const [role, financeAuthorized, allowed] of [['owner', false, true], ['admin', false, false], ['admin', true, true], [null, false, false]]) {
    const permissions = createPermissionService(modelsFor({ leaderRole: role, financeAuthorized }));
    assert.equal(await permissions.canManageFinance('user-1', 'org-1'), allowed);
    if (!allowed) await assert.rejects(permissions.assertManageFinance('user-1', 'org-1'), { code: 'FORBIDDEN' });
  }
});

test('staff templates deny sensitive writes and retain scoped report/support capabilities', async () => {
  for (const role of ['support', 'operations', 'read_only']) {
    const permissions = createPermissionService(modelsFor({ internalAdminRole: role }));
    await assert.rejects(permissions.assertInternal('user-1'), { code: 'FORBIDDEN' });
    await assert.rejects(permissions.assertInternalPermission('user-1', 'access.manage'), { code: 'FORBIDDEN' });
    assert.ok(await permissions.assertInternalIdentity('user-1'));
    assert.equal(await permissions.canManageFinance('user-1', 'org-1'), false);
    assert.equal(await permissions.canManageOrganization('user-1', 'org-1'), false);
    if (role === 'support') await assert.rejects(permissions.assertInternalPermission('user-1', 'reports.view'), { code: 'FORBIDDEN' });
    else assert.ok(await permissions.assertInternalPermission('user-1', 'reports.view'));
    if (role === 'operations') assert.equal((await permissions.assertManageEvent('user-1', 'event-1')).id, 'event-1');
    else await assert.rejects(permissions.assertManageEvent('user-1', 'event-1'), { code: 'FORBIDDEN' });
  }
  assert.ok(await createPermissionService(modelsFor({ internalAdminRole: 'platform_owner' })).assertInternal('user-1'));
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
test('creating an organization event alone does not grant direct guestlist approval', async () => {
  const models = modelsFor();
  models.Event.findByPk = async () => ({id:'event-1',creatorUserId:'user-1',organizationId:'org-1'});
  const permissions = createPermissionService(models);
  await assert.rejects(permissions.guestlistReviewScope('user-1','event-1'),{code:'FORBIDDEN'});
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

test('standalone guestlist and admission permissions reject expired or future assignment periods', async () => {
  for (const window of [{endsAt:new Date(Date.now()-1000)},{startsAt:new Date(Date.now()+86400000)}]) {
    const permissions = createPermissionService(modelsFor({eventAffiliate:{id:'affiliate-1',status:'active',accessScope:'event',...window}}));
    await assert.rejects(permissions.guestlistReviewScope('user-1','event-1'),{code:'FORBIDDEN'});
    await assert.rejects(permissions.assertAdmitEvent('user-1','event-1'),{code:'FORBIDDEN'});
  }
  const permissions = createPermissionService(modelsFor({eventAffiliate:{id:'affiliate-1',status:'active',accessScope:'event',endsAt:new Date(Date.now()+86400000)}}));
  assert.equal((await permissions.assertAdmitEvent('user-1','event-1')).id,'event-1');
});
