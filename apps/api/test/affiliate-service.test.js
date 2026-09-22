const test = require('node:test'); const assert = require('node:assert/strict'); const { resolveAffiliate } = require('../src/services/affiliate-service');
test('event terms override organization defaults rather than stacking', async () => {
  const orgAffiliate = { id: 'org-aff', userId: 'u1', status: 'active', defaultCommissionBps: 700, defaultGuestlistAllocation: 5 };
  const eventAffiliate = { id: 'event-aff', userId: 'u1', status: 'active', commissionBps: 1100, guestlistAllocation: 9, orgAffiliateId: 'org-aff' };
  const models = { EventAffiliate: { findOne: async ({ where }) => where.code === 'EVENT' ? eventAffiliate : null }, OrgAffiliate: { findOne: async () => orgAffiliate, findByPk: async () => orgAffiliate }, User: { findByPk: async () => ({ isActive: true }) } };
  const result = await resolveAffiliate(models, { event: { id: 'e1', organizationId: 'o1' }, code: 'EVENT' });
  assert.equal(result.commissionBps, 1100); assert.equal(result.guestlistAllocation, 9);
});
test('an org code adopts the selected event override for the same user', async () => {
  const orgAffiliate = { id: 'org-aff', userId: 'u1', status: 'active', defaultCommissionBps: 700, defaultGuestlistAllocation: 5 };
  const eventAffiliate = { id: 'event-aff', userId: 'u1', status: 'active', commissionBps: null, guestlistAllocation: 12 };
  const models = { EventAffiliate: { findOne: async ({ where }) => where.code ? null : eventAffiliate }, OrgAffiliate: { findOne: async () => orgAffiliate, findByPk: async () => orgAffiliate }, User: { findByPk: async () => ({ isActive: true }) } };
  const result = await resolveAffiliate(models, { event: { id: 'e1', organizationId: 'o1' }, code: 'ORG' });
  assert.equal(result.commissionBps, 700); assert.equal(result.guestlistAllocation, 12);
});

function employeeFixture({leaderRole} = {}) {
  const employee = { id:'30000000-0000-4000-8000-000000000001', organizationId:'venue', userId:'employee', status:'active' };
  if (leaderRole) employee.role = leaderRole;
  let present = true;
  const user = { isActive:true };
  const assignments = new Map();
  const models = {
    OrganizationEmployee:{findOne:async ({where}) => !leaderRole && present && Object.entries(where).every(([k,v]) => employee[k] === v) ? employee : null},
    OrganizationOwner:{findOne:async ({where}) => leaderRole && present && Object.entries(where).every(([k,v]) => employee[k] === v) ? employee : null},
    User:{findByPk:async () => user},
    EventAffiliate:{
      findOne:async ({where}) => [...assignments.values()].find((a) => Object.entries(where).every(([k,v]) => a[k] === v)) || null,
      findOrCreate:async ({where,defaults}) => { const row = assignments.get(where.eventId) || {id:`assignment-${where.eventId}`,...where,...defaults}; assignments.set(where.eventId,row); return [row,true]; },
    },
    OrgAffiliate:{findOne:async () => null},
  };
  const resolve = (overrides = {}) => resolveAffiliate(models,{event:{id:'event',organizationId:'venue'},code:`${leaderRole?'LEAD':'STAFF'}-${employee.id}`,transaction:{},...overrides});
  return {employee,user,assignments,resolve,removeMembership:()=>{present=false;}};
}
test('employees refer to existing and newly created venue events by default at zero commission', async () => {
  const f = employeeFixture();
  for (const id of ['existing-event','new-event']) {
    const result = await f.resolve({event:{id,organizationId:'venue'}});
    assert.equal(result.commissionBps,0);
    assert.equal(result.guestlistAllocation,0,'eligibility does not grant free guestlist capacity');
    assert.equal(result.eventAffiliate.userId,'employee');
  }
  await f.resolve({event:{id:'existing-event',organizationId:'venue'}});
  assert.equal(f.assignments.size,2,'repeated use must not duplicate assignments');
});
test('employee event overrides, including explicit zero and removal, take precedence', async () => {
  const f = employeeFixture();
  const {eventAffiliate} = await f.resolve();
  eventAffiliate.commissionBps = 2500;
  assert.equal((await f.resolve()).commissionBps,2500);
  eventAffiliate.commissionBps = 0;
  assert.equal((await f.resolve()).commissionBps,0);
  eventAffiliate.status = 'inactive';
  await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
  assert.equal(f.assignments.size,1,'an explicit removal cannot be automatically re-enabled');
});
test('employee defaults reject another venue, independent events, inactive membership and inactive users', async () => {
  const f = employeeFixture();
  await assert.rejects(f.resolve({event:{id:'foreign',organizationId:'other'}}),{code:'INVALID_AFFILIATE'});
  await assert.rejects(f.resolve({event:{id:'independent',organizationId:null}}),{code:'INVALID_AFFILIATE'});
  f.employee.status = 'inactive';
  await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
  f.employee.status = 'active'; f.user.isActive = false;
  await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
  assert.equal(f.assignments.size,0);
});
test('auto-created employee event codes are revoked when employment ends', async () => {
  const f = employeeFixture();
  const {eventAffiliate} = await f.resolve();
  f.employee.status = 'inactive';
  await assert.rejects(f.resolve({code:eventAffiliate.code}),{code:'INVALID_AFFILIATE'});
});

for (const leaderRole of ['owner','admin']) {
  test(`${leaderRole} referrals default to zero, preserve event overrides and reject removed membership`, async () => {
    const f = employeeFixture({leaderRole});
    const first = await f.resolve();
    assert.equal(first.commissionBps,0);
    assert.equal(first.guestlistAllocation,0);
    assert.match(first.eventAffiliate.code,/^LEADEV-/);
    first.eventAffiliate.commissionBps = 1750;
    assert.equal((await f.resolve()).commissionBps,1750);
    assert.equal((await f.resolve({code:first.eventAffiliate.code})).commissionBps,1750);
    assert.equal((await f.resolve({event:{id:'another-event',organizationId:'venue'}})).commissionBps,0);
    assert.equal(f.assignments.size,2);
    await assert.rejects(f.resolve({event:{id:'foreign',organizationId:'other'}}),{code:'INVALID_AFFILIATE'});
    await assert.rejects(f.resolve({event:{id:'independent',organizationId:null}}),{code:'INVALID_AFFILIATE'});
    f.user.isActive = false;
    await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
    f.user.isActive = true;
    first.eventAffiliate.status = 'inactive';
    await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
    first.eventAffiliate.status = 'active';
    f.removeMembership();
    await assert.rejects(f.resolve(),{code:'INVALID_AFFILIATE'});
    await assert.rejects(f.resolve({code:first.eventAffiliate.code}),{code:'INVALID_AFFILIATE'});
  });
}
