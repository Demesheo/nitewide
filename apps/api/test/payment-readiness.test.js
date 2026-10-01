const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPaidPublication, isSimulatedPaymentsRuntime } = require('../src/services/payment-readiness-service');
const { persistOffering, recordEventMutation } = require('../src/services/event-mutation-policy');
const production = { environment: 'production', hostedDemo: false };
const paid = { name: 'Package', kind: 'package', priceCents: 10000, isActive: true };

test('paid publication fails closed without trusted provider readiness, including caller flags', async () => {
  for (const runtime of [{}, production, { environment: 'staging' }]) {
    await assert.rejects(assertPaidPublication({ event: { status: 'published', onboardingEstablished: true, chargesEnabled: true }, offerings: [paid], ...runtime }), { code: 'PAYMENTS_NOT_READY' });
  }
});
test('free events, guestlist-only publication, paid drafts and disabled tiers need no Stripe', async () => {
  for (const offerings of [[], [{ ...paid, priceCents: 0 }], [{ ...paid, isActive: false }]]) {
    await assert.doesNotReject(assertPaidPublication({ event: { status: 'published' }, offerings, ...production }));
  }
  await assert.doesNotReject(assertPaidPublication({ event: { status: 'draft' }, offerings: [paid], ...production }));
  await assert.doesNotReject(assertPaidPublication({ event: { status: 'cancelled' }, offerings: [paid], ...production }));
});
test('only intentional server simulation runtimes permit simulated paid publication', async () => {
  for (const runtime of [{ environment: 'development' }, { environment: 'test' }, { ...production, hostedDemo: true }]) {
    assert.equal(isSimulatedPaymentsRuntime(runtime), true);
    await assert.doesNotReject(assertPaidPublication({ event: { status: 'published' }, offerings: [paid], ...runtime }));
  }
  assert.equal(isSimulatedPaymentsRuntime({ ...production, hostedDemo: 'true' }), false);
});
test('configured hosted-demo Stripe cannot bypass paid publication readiness', async () => {
  const runtime = { ...production, hostedDemo: true, stripe: { mode: 'test', enabled: false } };
  await assert.rejects(assertPaidPublication({ event: { status: 'published' }, offerings: [paid], ...runtime }), { code: 'PAYMENTS_NOT_READY' });
  await assert.doesNotReject(assertPaidPublication({ event: { status: 'published' }, offerings: [{ ...paid, priceCents: 0 }], ...runtime }));
});
test('legacy and admin shared offering persistence blocks enabling paid sales before writes', async () => {
  let writes = 0;
  const models = { Event: { findByPk: async () => ({ status: 'published' }) }, Offering: { create: async () => { writes++; } } };
  await assert.rejects(persistOffering({ models, eventId: 'e', values: paid, transaction: { LOCK: { UPDATE: 'UPDATE' } }, pricingValidated: true, ...production }), { code: 'PAYMENTS_NOT_READY' });
  assert.equal(writes, 0);
  await persistOffering({ models, eventId: 'e', values: { ...paid, priceCents: 0 }, transaction: { LOCK: { UPDATE: 'UPDATE' } }, pricingValidated: true, ...production });
  assert.equal(writes, 1);
});
test('legacy publication checks stored offerings before audit or publication notifications', async () => {
  let audits = 0;
  const models = { Offering: { findAll: async () => [paid] }, AuditLog: { create: async () => { audits++; } } };
  const saved = { id: 'e', status: 'published', toJSON: () => ({}) };
  const input = { models, saved, before: null, transaction: { LOCK: { UPDATE: 'UPDATE' } }, ...production };
  await assert.rejects(recordEventMutation(input), { code: 'PAYMENTS_NOT_READY' });
  assert.equal(audits, 0);
  models.Offering.findAll = async () => [];
  await recordEventMutation(input);
  assert.equal(audits, 1);
});
