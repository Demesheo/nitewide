const test = require('node:test'); const assert = require('node:assert/strict'); const { resolveAffiliate } = require('../src/services/affiliate-service');
test('event terms override organization defaults rather than stacking', async () => {
  const orgAffiliate = { id: 'org-aff', userId: 'u1', status: 'active', defaultCommissionBps: 700, defaultGuestlistAllocation: 5 };
  const eventAffiliate = { id: 'event-aff', userId: 'u1', status: 'active', commissionBps: 1100, guestlistAllocation: 9, orgAffiliateId: 'org-aff' };
  const models = { EventAffiliate: { findOne: async ({ where }) => where.code === 'EVENT' ? eventAffiliate : null }, OrgAffiliate: { findOne: async () => orgAffiliate, findByPk: async () => orgAffiliate } };
  const result = await resolveAffiliate(models, { event: { id: 'e1', organizationId: 'o1' }, code: 'EVENT' });
  assert.equal(result.commissionBps, 1100); assert.equal(result.guestlistAllocation, 9);
});
test('an org code adopts the selected event override for the same user', async () => {
  const orgAffiliate = { id: 'org-aff', userId: 'u1', status: 'active', defaultCommissionBps: 700, defaultGuestlistAllocation: 5 };
  const eventAffiliate = { id: 'event-aff', userId: 'u1', status: 'active', commissionBps: null, guestlistAllocation: 12 };
  const models = { EventAffiliate: { findOne: async ({ where }) => where.code ? null : eventAffiliate }, OrgAffiliate: { findOne: async () => orgAffiliate, findByPk: async () => orgAffiliate } };
  const result = await resolveAffiliate(models, { event: { id: 'e1', organizationId: 'o1' }, code: 'ORG' });
  assert.equal(result.commissionBps, 700); assert.equal(result.guestlistAllocation, 12);
});
