const test = require('node:test');
const assert = require('node:assert/strict');
const { commissionEligibility, commissionTerms, assertCommissionEligible, INDIVIDUAL_VERIFICATION_MAX_AGE_MS } = require('../src/domain/commission-eligibility');
const { assertCommissionPricing } = require('../src/domain/editor-pricing-policy');

const now = new Date('2026-10-01T12:00:00Z');
function individualContext() {
  return { userId: 'person', now, individualProfile: {
    userId: 'person', lifecycleState: 'active', status: 'active', provider: 'stripe', providerMode: 'test', stripeAccountId: 'acct_person', verifiedAt: now,
    verifiedStripeAccount: { id: 'acct_person', object: 'v2.core.account', livemode: false,
      identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['recipient'],
      configuration: { recipient: { applied: true, capabilities: { stripe_balance: {
        stripe_transfers: { status: 'active' }, payouts: { status: 'active' },
      } } } }, requirements: { entries: [] },
    },
  } };
}

test('individual setup fails closed while preserving configured terms and permitting zero', () => {
  const terms = commissionTerms(2500);
  assert.equal(terms.configuredCommissionBps, 2500);
  assert.equal(terms.effectiveCommissionBps, 0);
  assert.equal(terms.commissionEligibility.eligible, false);
  assert.equal(terms.commissionEligibility.reasonCode, 'INDIVIDUAL_STRIPE_ONBOARDING_REQUIRED');
  assert.doesNotThrow(() => assertCommissionEligible(0));
  assert.throws(() => assertCommissionEligible(2500), { code: 'COMMISSION_ONBOARDING_REQUIRED', status: 422 });
});

test('future individual readiness requires server-bound fresh individual recipient evidence', () => {
  const verified = individualContext();
  assert.equal(commissionEligibility(verified).eligible, true);
  assert.equal(commissionTerms(1500, verified).effectiveCommissionBps, 1500);
  assert.doesNotThrow(() => assertCommissionEligible(1500, verified));
  for (const corrupt of [
    (context) => { context.userId = 'someone-else'; },
    (context) => { context.individualProfile.organizationId = 'business'; },
    (context) => { context.individualProfile.lifecycleState = 'archived'; },
    (context) => { context.individualProfile.status = 'inactive'; },
    (context) => { context.individualProfile.deauthorizedAt = now; },
    (context) => { context.individualProfile.verifiedStripeAccount.closed = true; },
    (context) => { context.individualProfile.providerMode = 'live'; },
    (context) => { context.individualProfile.stripeAccountId = 'acct_unrelated'; },
    (context) => { context.individualProfile.verifiedAt = new Date(now.getTime() - INDIVIDUAL_VERIFICATION_MAX_AGE_MS - 1); },
    (context) => { context.individualProfile.verifiedAt = new Date(now.getTime() + 1); },
    (context) => { context.individualProfile.verifiedAt = 'invalid'; },
    (context) => { context.individualProfile.verifiedStripeAccount.identity.entity_type = 'company'; },
    (context) => { context.individualProfile.verifiedStripeAccount.livemode = true; },
    (context) => { context.individualProfile.verifiedStripeAccount.dashboard = 'express'; },
    (context) => { context.individualProfile.verifiedStripeAccount.applied_configurations = ['merchant']; },
    (context) => { context.individualProfile.verifiedStripeAccount.applied_configurations = 'recipient'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.recipient.applied = false; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.recipient.applied = 'true'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status = 'pending'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.recipient.capabilities.stripe_balance.payouts.status = 'inactive'; },
    (context) => { context.individualProfile.verifiedStripeAccount.requirements.entries.push({ minimum_deadline: { status: 'currently_due' } }); },
    (context) => { delete context.individualProfile.verifiedStripeAccount.requirements; },
  ]) {
    const context = structuredClone(verified); corrupt(context);
    assert.equal(commissionTerms(1500, context).effectiveCommissionBps, 0);
    assert.throws(() => assertCommissionEligible(1500, context), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  }
});

test('shared commission write guard rejects nonzero before database or pricing work', async () => {
  const models = { Event: { sequelize: { query: async () => { throw new Error('The guard must run before SQL'); } } } };
  await assert.rejects(assertCommissionPricing({ models, eventId: 'event', commissionBps: 1000 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  await assert.rejects(assertCommissionPricing({ models, organizationId: 'organization', commissionBps: 1000 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  await assertCommissionPricing({ models: { Event: { sequelize: { query: async () => [] } } }, eventId: 'event', commissionBps: 0 });
});
