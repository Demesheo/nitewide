const { stripeServerKeyMode } = require('../payments/stripe-keys');

// Temporary server-owned routing for dev/demo testing. Never accept this
// account from a checkout request or change provider scope on historical work.
function sharedSandboxAccountId(config = {}) {
  const id = config.STRIPE_SANDBOX_SHARED_ACCOUNT_ID;
  if (!id) return null;
  const simulated = ['development', 'test'].includes(config.NODE_ENV)
    || config.NODE_ENV === 'production' && (config.hostedDemo === true || config.HOSTED_DEMO === 'true');
  if (!simulated || config.STRIPE_MODE !== 'test' || !/^acct_[A-Za-z0-9]+$/.test(id)
    || stripeServerKeyMode(config.STRIPE_SECRET_KEY) !== 'test') {
    throw new Error('A shared sandbox merchant requires a development/test or hosted-demo runtime, Stripe test mode and a sandbox secret key');
  }
  return id;
}

// This server-written marker survives turning shared routing off. Pending
// retries/refunds must still use the merchant captured when checkout began.
function sharedSandboxOrderMatches(order, account, event) {
  const merchant = order.pricingPlanSnapshot?.merchant;
  return order.providerMode === 'test' && merchant?.sharedSandbox === true
    && merchant.organizationId === event?.organizationId
    && merchant.paymentAccountId === account?.id
    && merchant.stripeAccountId === account?.stripeAccountId;
}

module.exports = { sharedSandboxAccountId, sharedSandboxOrderMatches };
