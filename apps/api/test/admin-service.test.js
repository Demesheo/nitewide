const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { aggregateAdminSales, createAdminService } = require('../src/services/admin-service');
const serviceSource = readFileSync(require.resolve('../src/services/admin-service'), 'utf8');
const salesIndexMigration = readFileSync(require.resolve('../src/db/migrations/202609290002-admin-paid-sales-index.cjs'), 'utf8');

test('Overview sales use parameterized SQL aggregates in a consistent read-only snapshot and a selective paid-date index', () => {
  assert.match(serviceSource, /sequelize\.query\(sql, \{ type: QueryTypes\.SELECT, replacements, transaction \}\)/);
  assert.match(serviceSource, /const replacements = \{ since, organizationId \}/);
  assert.match(serviceSource, /CAST\(:organizationId AS uuid\)/);
  assert.match(serviceSource, /o\.status = 'paid' AND o\.paid_at >= :since/);
  assert.match(serviceSource, /isolationLevel: Transaction\.ISOLATION_LEVELS\.REPEATABLE_READ, readOnly: true/);
  assert.match(serviceSource, /loadAdminSales\(models, since, query\.organizationId \|\| null\)/);
  assert.doesNotMatch(serviceSource, /reportEventIds|const paidOrders =/);
  assert.match(salesIndexMigration, /ON orders \(paid_at, event_id\) WHERE status = 'paid'/);
  assert.match(salesIndexMigration, /CREATE INDEX CONCURRENTLY/);
});

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
