const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementController } = require('../src/controllers/management-controller');

test('business event analytics returns face-value sales and commissions without provider fees', async () => {
  let selectedAttributes;
  let payload;
  const models = {
    Order: { findAll: async ({ attributes }) => {
      selectedAttributes = attributes;
      return [{ subtotalCents: 2000, affiliateCommissionCents: 200, platformFeeCents: 229 }];
    } },
    Ticket: { count: async () => 2 },
    CheckIn: { count: async () => 1 },
    GuestlistEntry: { sum: async () => 0, count: async () => 0 },
  };
  const controller = createManagementController({ models, permissions: { assertManageEvent: async () => {} } });
  await controller.eventAnalytics({ userId: 'manager', params: { eventId: 'event' } }, { json: (value) => { payload = value; } });
  assert.deepEqual(selectedAttributes, ['subtotalCents', 'affiliateCommissionCents']);
  assert.equal(payload.data.grossSalesCents, 2000);
  assert.equal(payload.data.affiliateCommissionCents, 200);
  assert.equal('platformFeesCents' in payload.data, false);
});
