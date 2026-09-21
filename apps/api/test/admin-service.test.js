const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateAdminSales, createAdminService } = require('../src/services/admin-service');

test('admin sales aggregate paid totals by day, event, and organization', () => {
  const result = aggregateAdminSales([
    { totalCents: 1200, platformFeeCents: 179, affiliateCommissionCents: 100, paidAt: '2026-09-20T02:00:00Z', event: { id: 'e1', title: 'Friday', organization: { id: 'o1', name: 'OHM' } } },
    { totalCents: 30000, platformFeeCents: 3040, affiliateCommissionCents: 1000, paidAt: '2026-09-20T03:00:00Z', event: { id: 'e1', title: 'Friday', organization: { id: 'o1', name: 'OHM' } } },
    { totalCents: 1000, platformFeeCents: 154, affiliateCommissionCents: 0, paidAt: '2026-09-21T03:00:00Z', event: { id: 'e2', title: 'Sunday', organization: null } },
  ]);
  assert.deepEqual(result.summary, { orders: 3, grossSalesCents: 32200, platformFeesCents: 3373, affiliateCommissionsCents: 1100 });
  assert.equal(result.events[0].label, 'Friday');
  assert.equal(result.events[0].salesCents, 31200);
  assert.equal(result.organizations.find((row) => row.id === 'independent').salesCents, 1000);
  assert.equal(result.daily.length, 2);
});

test('admin edit is permission checked before lookup or write', async () => {
  let touched = false;
  const service = createAdminService({
    models: { User: { findByPk: async () => { touched = true; } } },
    permissions: { assertInternal: async () => { const error = new Error('forbidden'); error.code = 'FORBIDDEN'; throw error; } },
  });
  await assert.rejects(() => service.updateUser('outsider', 'target', { displayName: 'Changed', reason: 'test' }), { code: 'FORBIDDEN' });
  assert.equal(touched, false);
});

test('an admin cannot remove their own admin role', async () => {
  const record = { id: 'admin', toJSON: () => ({ id: 'admin' }) };
  const service = createAdminService({
    models: { User: { findByPk: async () => record } },
    permissions: { assertInternal: async () => ({ id: 'admin' }) },
  });
  await assert.rejects(() => service.updateUser('admin', 'admin', { isInternalAdmin: false, reason: 'test' }), { code: 'SELF_ADMIN_LOCKOUT' });
});
