const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommissionSettingsService } = require('../src/services/commission-settings-service');
const schemas = require('../src/http/commission-schemas');
const record = (data) => Object.assign(data, { update: async function (values) { Object.assign(this, values); return this; } });
function fixture({ finance = true } = {}) {
  const org = record({ id: 'org', commissionMinimumSubtotalCents: 1000 });
  const event = record({ id: 'event', organizationId: org.id, commissionMinimumSubtotalCents: null, status: 'published', endsAt: new Date(Date.now() + 86400000) });
  const affiliate = record({ id: 'affiliate', userId: 'person', organizationId: 'org', defaultCommissionBps: 0, status: 'active' });
  let audits = 0;
  const sequelize = { transaction: async (_options, work) => work({ LOCK: { UPDATE: 'UPDATE' } }), query: async () => [] };
  const models = { Organization: { sequelize, findByPk: async () => org }, Event: { sequelize, findByPk: async () => event },
    User: { findByPk: async () => ({ id: 'person', isActive: true }) }, OrgAffiliate: { findOne: async () => affiliate },
    AuditLog: { create: async () => { audits += 1; } } };
  const permissions = { assertManageOrganization: async () => {}, assertManageEvent: async () => {},
    assertManageFinance: async () => { if (!finance) throw Object.assign(new Error('Finance authorization required'), { code: 'FORBIDDEN' }); } };
  return { service: createCommissionSettingsService({ models, permissions }), org, event, affiliate, audits: () => audits };
}
test('minimum schemas enforce the $10 floor and permit explicit event inheritance only', () => {
  assert.equal(schemas.organizationCommissionSettings.safeParse({ minimumSubtotalCents: 999 }).success, false);
  assert.equal(schemas.organizationCommissionSettings.safeParse({ minimumSubtotalCents: null }).success, false);
  assert.equal(schemas.eventCommissionSettings.safeParse({ minimumSubtotalCents: null }).success, true);
  assert.equal(schemas.organizationPersonCommissionSettings.safeParse({ defaultCommissionBps: 4001 }).success, false);
});
test('event minimum overrides organization and can revert to inheritance for future orders', async () => {
  const f = fixture();
  await f.service.organization('owner', 'org', { minimumSubtotalCents: 2500 });
  assert.equal((await f.service.event('owner', 'event')).effectiveMinimumSubtotalCents, 2500);
  assert.equal((await f.service.event('owner', 'event', { minimumSubtotalCents: 1500 })).effectiveMinimumSubtotalCents, 1500);
  assert.equal((await f.service.event('owner', 'event', { minimumSubtotalCents: null })).effectiveMinimumSubtotalCents, 2500);
  assert.equal(f.audits(), 3);
});
test('person default rates require finance access and verified personal readiness, while explicit zero is permitted', async () => {
  const f = fixture();
  await assert.rejects(f.service.personRate('owner', 'org', 'person', { defaultCommissionBps: 1000 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  assert.equal(f.affiliate.defaultCommissionBps, 0); assert.equal(f.audits(), 0);
  const zero = await f.service.personRate('owner', 'org', 'person', { defaultCommissionBps: 0 });
  assert.equal(zero.effectiveCommissionBps, 0); assert.equal(zero.appliesTo, 'future_orders');
  await assert.rejects(fixture({ finance: false }).service.personRate('manager', 'org', 'person', { defaultCommissionBps: 0 }), { code: 'FORBIDDEN' });
});
