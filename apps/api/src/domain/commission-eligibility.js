const { DomainError } = require('./errors');
const { isStripeMode, matchesStripeLivemode } = require('../payments/stripe-mode');

// Business merchant accounts never prove personal eligibility. Only a profile
// bound to the authenticated person and server-retrieved individual evidence
// may unlock a configured rate. Live execution remains independently gated.
const INDIVIDUAL_VERIFICATION_MAX_AGE_MS = 5 * 60 * 1000;
function commissionEligibility({ userId, individualProfile, now = new Date(), mode = 'test' } = {}) {
  const locked = {
    eligible: false,
    status: 'individual_setup_required',
    reasonCode: 'INDIVIDUAL_STRIPE_ONBOARDING_REQUIRED',
    reason: 'Complete individual Stripe onboarding before earning commission.',
    effectiveCommissionBps: 0,
  };
  if (!individualProfile) return locked;
  const account = individualProfile.verifiedStripeAccount;
  const verificationAge = new Date(now).getTime() - new Date(individualProfile.verifiedAt).getTime();
  const merchant = account?.configuration?.merchant;
  const responsibilities = account?.defaults?.responsibilities;
  const appliedAt = typeof merchant?.applied === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(merchant.applied) ? Date.parse(merchant.applied) : NaN;
  const merchantApplied = merchant?.applied === true || (Number.isFinite(appliedAt) && appliedAt <= new Date(now).getTime());
  const individualReady = userId && individualProfile.userId === userId && !individualProfile.organizationId
    && individualProfile.lifecycleState === 'active' && individualProfile.status === 'active' && !individualProfile.deauthorizedAt && !individualProfile.paymentsDisabledAt
    && (!individualProfile.disconnectStatus || individualProfile.disconnectStatus === 'none')
    && individualProfile.provider === 'stripe' && isStripeMode(mode) && individualProfile.providerMode === mode
    && individualProfile.stripeAccountId && individualProfile.stripeAccountId === account?.id
    && account?.object === 'v2.core.account' && matchesStripeLivemode(account, mode) && account.closed !== true
    && account.identity?.entity_type === 'individual' && account.dashboard === 'full'
    && responsibilities?.fees_collector === 'stripe' && responsibilities?.losses_collector === 'stripe' && responsibilities?.requirements_collector === 'stripe'
    && Array.isArray(account.applied_configurations) && account.applied_configurations.includes('merchant') && merchantApplied
    && merchant.capabilities?.card_payments?.status === 'active'
    && merchant.capabilities?.stripe_balance?.payouts?.status === 'active'
    && Array.isArray(account.requirements?.entries) && account.requirements.entries.length === 0
    && Number.isFinite(verificationAge) && verificationAge >= 0 && verificationAge <= INDIVIDUAL_VERIFICATION_MAX_AGE_MS;
  return individualReady ? { eligible: true, status: 'ready', reasonCode: null, reason: null, effectiveCommissionBps: null } : {
    ...locked, status: 'individual_verification_required', reasonCode: 'INDIVIDUAL_STRIPE_VERIFICATION_REQUIRED',
    reason: 'Individual Stripe onboarding must be complete and freshly verified before earning commission.',
  };
}

function effectiveCommissionBps(configuredCommissionBps = 0, context) {
  return commissionEligibility(context).eligible ? configuredCommissionBps : 0;
}

function commissionTerms(configuredCommissionBps = 0, context) {
  return {
    configuredCommissionBps,
    effectiveCommissionBps: effectiveCommissionBps(configuredCommissionBps, context),
    commissionEligibility: commissionEligibility(context),
  };
}

function assertCommissionEligible(commissionBps, context) {
  const eligibility = commissionEligibility(context);
  if (commissionBps > 0 && !eligibility.eligible) {
    throw new DomainError(eligibility.reason, {
      code: 'COMMISSION_ONBOARDING_REQUIRED',
      status: 422,
      details: { commissionEligibility: eligibility },
    });
  }
}

module.exports = { commissionEligibility, effectiveCommissionBps, commissionTerms, assertCommissionEligible, INDIVIDUAL_VERIFICATION_MAX_AGE_MS };
