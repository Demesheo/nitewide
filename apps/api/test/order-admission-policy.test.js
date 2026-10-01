const test = require('node:test');
const assert = require('node:assert/strict');
const { orderAdmissionEligible, orderAdmissionSql } = require('../src/domain/order-admission-policy');
const { createAdmissionsService } = require('../src/services/admissions-service');
test('legacy/free/demo paid orders retain admission despite migration default pending', () => {
  for (const pricingPlanSnapshot of [{}, { demo: true }, { free: true }]) assert.equal(orderAdmissionEligible({ status: 'paid', providerVerificationStatus: 'pending', pricingPlanSnapshot }), true);
  for (const field of ['providerMode', 'paymentAccountId', 'stripeAccountId', 'checkoutSessionId', 'stripePaymentIntentId', 'stripeChargeId']) assert.equal(orderAdmissionEligible({ status: 'paid', [field]: '' }), false);
  assert.equal(orderAdmissionEligible({ status: 'paid', pricingPlanSnapshot: { stripeFeeDecision: {} } }), false);
  assert.equal(orderAdmissionEligible({ status: 'refunded' }), false);
});
test('roster and headcounts apply shared provider admission predicate before aggregation', async () => {
  let sql;
  const service = createAdmissionsService({ now: () => new Date('2026-10-01T12:00:00Z'), permissions: { assertAdmitEvent: async () => ({ status: 'published', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-02T00:00:00Z' }) }, models: { Event: { sequelize: { query: async (query) => { sql = query; return [{ total: 0, expected: 0, admitted: 0, entries: [] }]; } } } } });
  await service.roster('staff', 'event');
  assert.ok(sql.includes(orderAdmissionSql('o')));
  assert.ok(sql.indexOf(orderAdmissionSql('o')) < sql.indexOf('UNION ALL'));
  assert.throws(() => orderAdmissionSql('o;DROP'), TypeError);
});
