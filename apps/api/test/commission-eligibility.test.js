const test = require('node:test');
const assert = require('node:assert/strict');
const { commissionEligibility, commissionTerms, assertCommissionEligible, INDIVIDUAL_VERIFICATION_MAX_AGE_MS } = require('../src/domain/commission-eligibility');
const { assertCommissionPricing } = require('../src/domain/editor-pricing-policy');

const now = new Date('2026-10-01T12:00:00Z');
function individualContext() {
  return { userId: 'person', now, individualProfile: {
    userId: 'person', lifecycleState: 'active', status: 'active', provider: 'stripe', providerMode: 'test', stripeAccountId: 'acct_person', verifiedAt: now,
    verifiedStripeAccount: { id: 'acct_person', object: 'v2.core.account', livemode: false,
      identity: { entity_type: 'individual' }, dashboard: 'full', applied_configurations: ['merchant'],
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: {
        payouts: { status: 'active' },
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

test('individual readiness requires server-bound fresh individual merchant evidence', () => {
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
    (context) => { context.individualProfile.paymentsDisabledAt = now; },
    (context) => { context.individualProfile.verifiedStripeAccount.closed = true; },
    (context) => { context.individualProfile.providerMode = 'live'; },
    (context) => { context.individualProfile.stripeAccountId = 'acct_unrelated'; },
    (context) => { context.individualProfile.verifiedAt = new Date(now.getTime() - INDIVIDUAL_VERIFICATION_MAX_AGE_MS - 1); },
    (context) => { context.individualProfile.verifiedAt = new Date(now.getTime() + 1); },
    (context) => { context.individualProfile.verifiedAt = 'invalid'; },
    (context) => { context.individualProfile.verifiedStripeAccount.identity.entity_type = 'company'; },
    (context) => { context.individualProfile.verifiedStripeAccount.livemode = true; },
    (context) => { context.individualProfile.verifiedStripeAccount.dashboard = 'express'; },
    (context) => { context.individualProfile.verifiedStripeAccount.applied_configurations = ['recipient']; },
    (context) => { context.individualProfile.verifiedStripeAccount.applied_configurations = 'recipient'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.merchant.applied = false; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.merchant.applied = 'true'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.merchant.capabilities.card_payments.status = 'pending'; },
    (context) => { context.individualProfile.verifiedStripeAccount.configuration.merchant.capabilities.stripe_balance.payouts.status = 'inactive'; },
    (context) => { context.individualProfile.verifiedStripeAccount.defaults.responsibilities.fees_collector = 'application'; },
    (context) => { context.individualProfile.verifiedStripeAccount.requirements.entries.push({ minimum_deadline: { status: 'currently_due' } }); },
    (context) => { delete context.individualProfile.verifiedStripeAccount.requirements; },
  ]) {
    const context = structuredClone(verified); corrupt(context);
    assert.equal(commissionTerms(1500, context).effectiveCommissionBps, 0);
    assert.throws(() => assertCommissionEligible(1500, context), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  }
});
test('applied merchant timestamps from freshly retrieved provider evidence are supported', () => {
  const context = individualContext();
  context.individualProfile.verifiedStripeAccount.configuration.merchant.applied = '2026-09-01T00:00:00Z';
  assert.equal(commissionEligibility(context).eligible, true);
  context.individualProfile.verifiedStripeAccount.configuration.merchant.applied = '2027-01-01T00:00:00Z';
  assert.equal(commissionEligibility(context).eligible, false);
});
test('individual eligibility and SQL ordering accept only the runtime mode and matching provider evidence', () => {
  const { commissionEligibilitySql } = require('../src/services/commission-profile-repository');
  for (const mode of ['test', 'live']) {
    const context = individualContext(); context.mode = mode;
    context.individualProfile.providerMode = mode;
    context.individualProfile.verifiedStripeAccount.livemode = mode === 'live';
    assert.equal(commissionEligibility(context).eligible, true);
    assert.match(commissionEligibilitySql('cp', ':observed', mode), new RegExp(`provider_mode='${mode}'`));
    assert.match(commissionEligibilitySql('cp', ':observed', mode), new RegExp(`livemode'='${mode === 'live'}'::jsonb`));
    for (const other of ['disabled', mode === 'live' ? 'test' : 'live']) assert.equal(commissionEligibility({ ...context, mode: other }).eligible, false);
    for (const invalid of [null, undefined, 'true', mode !== 'live']) {
      context.individualProfile.verifiedStripeAccount.livemode = invalid;
      assert.equal(commissionEligibility(context).eligible, false);
    }
  }
  assert.equal(commissionEligibilitySql('cp', ':observed', 'disabled'), 'FALSE');
  assert.equal(commissionEligibilitySql('cp', ':observed', "live' OR TRUE"), 'FALSE');
});

test('shared commission write guard rejects nonzero before database or pricing work', async () => {
  const models = { Event: { sequelize: { query: async () => { throw new Error('The guard must run before SQL'); } } } };
  await assert.rejects(assertCommissionPricing({ models, eventId: 'event', commissionBps: 1000 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  await assert.rejects(assertCommissionPricing({ models, organizationId: 'organization', commissionBps: 1000 }), { code: 'COMMISSION_ONBOARDING_REQUIRED' });
  await assertCommissionPricing({ models: { Event: { sequelize: { query: async () => [] } } }, eventId: 'event', commissionBps: 0 });
});
