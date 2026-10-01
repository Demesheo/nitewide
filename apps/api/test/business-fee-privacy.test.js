const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementController } = require('../src/controllers/management-controller');

test('business event analytics returns face-value sales and commissions without provider fees', async () => {
  let selectedSql;
  let payload;
  const models = {
    Event: { sequelize: { query: async (sql, options) => {
      selectedSql = sql;
      assert.deepEqual(options.replacements, { eventId: 'event' });
      return [{ grossSalesCents: '2000', affiliateCommissionCents: '200', paidOrders: 1, ticketsSold: 2, checkedIn: 1, guestlistConfirmed: 0, guestlistPending: 0 }];
    } } },
  };
  const controller = createManagementController({ models, permissions: { assertManageEvent: async () => {} } });
  await controller.eventAnalytics({ userId: 'manager', params: { eventId: 'event' } }, { json: (value) => { payload = value; } });
  assert.match(selectedSql, /SUM\(subtotal_cents\)/);
  assert.match(selectedSql, /SUM\(affiliate_commission_cents\)/);
  assert.doesNotMatch(selectedSql, /platform_fee|processing_cost/i);
  assert.equal(payload.data.grossSalesCents, 2000);
  assert.equal(payload.data.affiliateCommissionCents, 200);
  assert.equal('platformFeesCents' in payload.data, false);
  assert.equal(payload.data.attendanceRate, 0.5);
});
