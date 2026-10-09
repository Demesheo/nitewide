const { assertPublicAppUrl } = require('../domain/app-routing');
const { sharedSandboxAccountId } = require('../domain/shared-sandbox-merchant');
const { isStripeMode } = require('./stripe-mode');
const { stripeServerKeyMode, stripePublishableKeyMode } = require('./stripe-keys');

// Shared by startup and direct client construction so bypassing getConfig does
// not permit live credentials in a sandbox or silently mix payment modes.
function validateStripeSettings(config = {}) {
  const mode = config.STRIPE_MODE ?? 'disabled';
  if (mode !== 'disabled' && !isStripeMode(mode)) throw new Error('Invalid STRIPE_MODE');
  const secretMode = stripeServerKeyMode(config.STRIPE_SECRET_KEY);
  const publishableMode = stripePublishableKeyMode(config.STRIPE_PUBLISHABLE_KEY);
  for (const [name, keyMode] of [['STRIPE_SECRET_KEY', secretMode], ['STRIPE_PUBLISHABLE_KEY', publishableMode]]) {
    if (config[name] && !keyMode) throw new Error(`${name} must be a Stripe test or live key`);
    if (isStripeMode(mode) && keyMode && keyMode !== mode) throw new Error(`${name} must match STRIPE_MODE`);
  }
  if (secretMode && publishableMode && secretMode !== publishableMode) throw new Error('Stripe secret and publishable keys must use the same mode');
  if (mode === 'live' || secretMode === 'live' || publishableMode === 'live') {
    if (config.NODE_ENV !== 'production' || config.APP_ENVIRONMENT !== 'production'
      || config.HOSTED_DEMO !== 'false' || config.hostedDemo === true) {
      throw new Error('Live Stripe requires NODE_ENV=production, APP_ENVIRONMENT=production and HOSTED_DEMO=false');
    }
  }
  for (const name of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET']) {
    if (config[name] && !/^whsec_[A-Za-z0-9]+$/.test(config[name])) throw new Error(`${name} must be a Stripe webhook signing secret`);
  }
  if (isStripeMode(mode) && !secretMode) throw new Error(`Stripe ${mode} mode requires STRIPE_SECRET_KEY`);
  if (mode === 'live') {
    for (const name of ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_WEBHOOK_SECRET']) {
      if (!config[name]) throw new Error(`Stripe live mode requires ${name}`);
    }
    if (config.STRIPE_WEBHOOK_SECRET === config.STRIPE_ACCOUNT_WEBHOOK_SECRET) {
      throw new Error('Stripe live snapshot and Accounts v2 destinations require distinct webhook signing secrets');
    }
  }
  if (isStripeMode(mode) && (config.NODE_ENV === 'production' || config.HOSTED_DEMO === 'true' || config.hostedDemo === true)) {
    for (const name of ['CUSTOMER_APP_URL', 'BUSINESS_APP_URL']) assertPublicAppUrl(config[name], name);
  }
  sharedSandboxAccountId(config);
}

module.exports = { validateStripeSettings };
