const { DomainError } = require('./errors');

// Business PaymentAccounts are merchant accounts, not proof that a person has
// completed recipient onboarding. The optional profile must come from a future
// server-owned individual profile repository and fresh Stripe retrieval, never
// request JSON. Current call sites have no such repository and pass no profile.
const INDIVIDUAL_VERIFICATION_MAX_AGE_MS = 5 * 60 * 1000;
function commissionEligibility({ userId, individualProfile, now = new Date() } = {}) {
  const locked = {
    eligible: false,
    status: 'individual_setup_required',
    reasonCode: 'INDIVIDUAL_STRIPE_ONBOARDING_REQUIRED',
    reason: 'Complete individual Stripe onboarding before earning commission. Individual payment setup is not available yet.',
    effectiveCommissionBps: 0,
  };
  if (!individualProfile) return locked;
  const account = individualProfile.verifiedStripeAccount;
  const verificationAge = new Date(now).getTime() - new Date(individualProfile.verifiedAt).getTime();
  const recipient = account?.configuration?.recipient;
  const individualReady = userId && individualProfile.userId === userId && !individualProfile.organizationId
    && individualProfile.lifecycleState === 'active' && individualProfile.status === 'active' && !individualProfile.deauthorizedAt
    && individualProfile.provider === 'stripe' && individualProfile.providerMode === 'test'
    && individualProfile.stripeAccountId && individualProfile.stripeAccountId === account?.id
    && account?.object === 'v2.core.account' && account.livemode === false && account.closed !== true
    && account.identity?.entity_type === 'individual' && account.dashboard === 'full'
    && Array.isArray(account.applied_configurations) && account.applied_configurations.includes('recipient') && recipient?.applied === true
    && recipient.capabilities?.stripe_balance?.stripe_transfers?.status === 'active'
    && recipient.capabilities?.stripe_balance?.payouts?.status === 'active'
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
