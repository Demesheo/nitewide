const test = require('node:test'); const assert = require('node:assert/strict'); const { createCheckoutService } = require('../src/services/checkout-service');
function fixture({ sold = 0, total = 5, environment = 'development', hostedDemo = false, priceCents = 2000, commissionBps = 0, verifiedIndividual = false, minimumSubtotalCents } = {}) {
  // Provider evidence and checkout share one clock. Creating evidence after
  // checkout samples Date.now() can otherwise make it appear future-dated.
  const current = new Date('2026-10-03T12:00:00.000Z');
  let increments = 0; const offering = { id: '50000000-0000-4000-8000-000000000001', eventId: 'e1', name: 'GA', kind: 'ticket', priceCents: 2000, currency: 'USD', inventoryMode: 'finite', quantityTotal: total, quantitySold: sold, entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 4, isActive: true, increment: async (_field, { by }) => { increments += by; } };
  offering.priceCents = priceCents;
  const created = { tickets: 0, payment: null, notificationJobs: [], userReads: 0 }; const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const models = {
    User: { findByPk: async () => { created.userReads += 1; return { id: 'u1', isActive: true }; } },
    OrganizationOwner: { findAll: async () => { throw new Error('Recipient resolution belongs outside checkout'); } },
    Notification: { create: async () => { throw new Error('Fan-out writes belong outside checkout'); } },
    Order: { findOne: async () => null, create: async (data) => ({ id: 'order-1', ...data }) },
    Event: { findByPk: async () => ({ id: 'e1', title: 'Night', endsAt: new Date(current.getTime() + 86400000), status: 'published', organizationId: 'o1', commissionMinimumSubtotalCents: minimumSubtotalCents }) },
    Organization: { findByPk: async () => ({ id: 'o1', status: 'active', planTier: 'free' }) }, Offering: { findAll: async () => [offering] },
    EventAffiliate: { findOne: async () => ({ id: 'legacy-referral', userId: 'promoter', code: 'LEGACY', accessScope: 'event', status: 'active', commissionBps }) }, OrgAffiliate: {},
    IndividualCommissionProfile: { findOne: async () => verifiedIndividual ? { id: 'profile', userId: 'promoter', provider: 'stripe', providerMode: 'test',
      lifecycleState: 'active', status: 'active', stripeAccountId: 'acct_person', verifiedAt: current, verifiedStripeAccount: {
        id: 'acct_person', object: 'v2.core.account', livemode: false, identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
        configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] },
      } } : null },
    OrderItem: { create: async (data) => ({ id: 'item-1', ...data }) }, Ticket: { create: async () => ({ id: `ticket-${++created.tickets}` }) },
    Payment: { create: async (data) => { created.payment = data; return data; } }, AffiliateAttribution: { create: async () => ({}) }, AuditLog: { create: async () => ({}) },
  };
  const sequelize = { transaction: async (_options, work) => work(tx) };
  const notificationJobs = { enqueueCheckout: async (payload, transaction) => { assert.equal(transaction, tx); created.notificationJobs.push(payload); } };
  return { checkout: createCheckoutService({ sequelize, models, now: () => current, environment, hostedDemo, notificationJobs }), getIncrements: () => increments, created };
}
test('checkout snapshots a sale, increments inventory, and creates credentials', async () => {
  const f = fixture(); const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'unique-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 2 }], payment: { provider: 'demo', reference: 'pay-1', status: 'succeeded' } });
  assert.equal(result.order.subtotalCents, 4000); assert.equal(result.order.platformFeeCents, 480); assert.equal(result.order.totalCents, 4480); assert.equal(result.order.pricingPlanSnapshot.processingPaidBy, 'platform'); assert.equal(f.created.payment.amountCents, 4480); assert.equal(f.getIncrements(), 2); assert.equal(result.credentials.length, 2);
  assert.equal(f.created.notificationJobs.length, 1);
  assert.equal(f.created.notificationJobs[0].orderId, result.order.id);
  assert.equal(f.created.notificationJobs[0].names, '2 × GA');
  assert.equal(f.created.userReads, 1, 'checkout only reads the buyer for authorization, not notification formatting');
});
test('checkout rejects inventory oversells before writing an order', async () => {
  const f = fixture({ sold: 4, total: 5 }); await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'unique-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 2 }], payment: { provider: 'test', reference: 'pay-1', status: 'succeeded' } }), (error) => error.code === 'INSUFFICIENT_INVENTORY'); assert.equal(f.getIncrements(), 0);
});
test('new demo bookings lock legacy nonzero terms at zero until individual Stripe onboarding', async () => {
  const f = fixture({ commissionBps: 2500 });
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', affiliateCode: 'LEGACY', idempotencyKey: 'legacy-referral-sale',
    items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', status: 'succeeded' } });
  assert.equal(result.order.eventAffiliateId, 'legacy-referral', 'referral attribution remains available');
  assert.equal(result.order.affiliateCommissionCents, 0);
  assert.equal(result.order.pricingPlanSnapshot.commissionBps, 0);
  assert.equal(result.order.pricingPlanSnapshot.configuredCommissionBps, 2500);
  assert.equal(result.order.pricingPlanSnapshot.commissionEligibility.reasonCode, 'INDIVIDUAL_STRIPE_ONBOARDING_REQUIRED');
});
test('verified personal referrals use the combined paid subtotal and snapshot the event minimum', async () => {
  const buy = (f, quantity) => f.checkout({ buyerUserId: 'u1', eventId: 'e1', affiliateCode: 'LEGACY', idempotencyKey: 'threshold-test',
    items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity }], payment: { provider: 'demo', status: 'succeeded' } });
  const below = await buy(fixture({ priceCents: 600, commissionBps: 1000, verifiedIndividual: true }), 1);
  assert.equal(below.order.affiliateCommissionCents, 0);
  assert.equal(below.order.commissionSnapshot.configuredCommissionBps, 1000);
  assert.equal(below.order.commissionSnapshot.effectiveCommissionBps, 0);
  const combined = await buy(fixture({ priceCents: 600, commissionBps: 1000, verifiedIndividual: true }), 2);
  assert.equal(combined.order.affiliateCommissionCents, 120);
  assert.equal(combined.order.commissionSnapshot.commissionEligibility.eligible, true);
  assert.equal(combined.order.commissionSnapshot.capturedAt, '2026-10-03T12:00:00.000Z');
  assert.equal(combined.order.commissionSnapshot.recipientUserId, 'promoter');
  assert.equal(combined.order.commissionSnapshot.individualCommissionProfileId, 'profile');
  const raised = await buy(fixture({ priceCents: 600, commissionBps: 1000, verifiedIndividual: true, minimumSubtotalCents: 1500 }), 2);
  assert.equal(raised.order.affiliateCommissionCents, 0);
  assert.equal(raised.order.commissionSnapshot.minimumSubtotalCents, 1500);
  const free = await buy(fixture({ priceCents: 0, commissionBps: 1000, verifiedIndividual: true }), 1);
  assert.equal(free.order.totalCents, 0);
  assert.equal(free.order.commissionSnapshot.effectiveCommissionBps, 0);
});
test('local demo checkout records a labeled order, payment and inventory movement', async () => {
  const f = fixture();
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'demo-key-1', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-1', status: 'succeeded' } });
  assert.equal(result.order.pricingPlanSnapshot.demo, true);
  assert.equal(result.order.affiliateCommissionCents, 0);
  assert.equal(f.created.payment.provider, 'demo');
  assert.equal(f.getIncrements(), 1);
  assert.equal(result.credentials.length, 1);
});
test('production does not accept demo checkout', async () => {
  const f = fixture({ environment: 'production' });
  await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'demo-key-1', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-1', status: 'succeeded' } }), { code: 'DEMO_DISABLED' });
  assert.equal(f.getIncrements(), 0);
});
test('protected hosted demo accepts mock sales while retaining production runtime', async () => {
  const f = fixture({ environment: 'production', hostedDemo: true });
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'hosted-demo', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo-hosted', status: 'succeeded' } });
  assert.equal(result.order.pricingPlanSnapshot.demo, true);
  assert.equal(f.created.payment.provider, 'demo');
  assert.equal(f.getIncrements(), 1);
});
test('hosted demo rejects claimed live payments before any transaction writes', async () => {
  const f = fixture({ environment: 'production', hostedDemo: true });
  await assert.rejects(() => f.checkout({ payment: { provider: 'stripe', status: 'succeeded' } }), { code: 'DEMO_ONLY' });
  assert.equal(f.getIncrements(), 0);
  assert.equal(f.created.payment, null);
});
test('caller-supplied success cannot fulfill paid sales in any runtime', async () => {
  for (const environment of ['development', 'test', 'production']) {
    for (const payment of [undefined, { provider: 'stripe', reference: 'pi_claimed', status: 'succeeded' }, { provider: 'test', reference: 'claimed', status: 'succeeded' }]) {
      const f = fixture({ environment });
      await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'unverified-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment }), { code: 'PAYMENTS_NOT_ENABLED' });
      assert.equal(f.getIncrements(), 0);
      assert.equal(f.created.tickets, 0);
      assert.equal(f.created.payment, null);
      assert.deepEqual(f.created.notificationJobs, []);
    }
  }
});
test('truly free production checkout issues admission without a payment account or provider claim', async () => {
  const f = fixture({ environment: 'production', priceCents: 0 });
  const result = await f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'free-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'stripe', reference: 'fake', status: 'succeeded' } });
  assert.equal(result.order.totalCents, 0);
  assert.equal(f.created.payment.provider, 'free');
  assert.equal(f.created.payment.providerReference, 'free-order-1');
  assert.equal(result.credentials.length, 1);
});
test('demo checkout requires an explicit development, test, or hosted-demo mode', async () => {
  const f = fixture({ environment: 'staging' });
  await assert.rejects(() => f.checkout({ buyerUserId: 'u1', eventId: 'e1', idempotencyKey: 'demo-staging', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }], payment: { provider: 'demo', reference: 'demo', status: 'succeeded' } }), { code: 'DEMO_DISABLED' });
});

test('idempotent replay preserves historical fee amount and payer without repricing', async () => {
  const historical = { id: 'historical', eventId: 'historical-event', items: [{ offeringId: 'historical-offering', quantity: 2 }], subtotalCents: 10000, platformFeeCents: 829,
    totalCents: 10829, affiliateCommissionCents: 1000, pricingPlanSnapshot: { percentageBps: 750, perPaidOrderCents: 79, processingPaidBy: 'organizer', commissionBps: 1000 } };
  const models = { User: { findByPk: async () => ({ id: 'buyer', isActive: true }) }, Order: { findOne: async () => historical }, OrderItem: {} };
  const sequelize = { transaction: async (_options, run) => run({ LOCK: { UPDATE: 'UPDATE' } }) };
  const checkout = createCheckoutService({ sequelize, models });
  const result = await checkout({ buyerUserId: 'buyer', eventId: historical.eventId,
    items: [{ offeringId: 'historical-offering', quantity: 2 }], idempotencyKey: 'already-paid' });
  assert.equal(result.order, historical);
  assert.equal(result.order.totalCents, 10829);
  assert.equal(result.order.pricingPlanSnapshot.processingPaidBy, 'organizer');
  assert.equal(result.order.affiliateCommissionCents, 1000);
  assert.equal(result.order.pricingPlanSnapshot.commissionBps, 1000, 'eligibility changes cannot rewrite historical commission');
  assert.equal(result.replayed, true);
  assert.deepEqual(result.credentials, []);
});
