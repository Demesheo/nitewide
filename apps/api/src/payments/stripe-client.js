const { DomainError } = require('../domain/errors');

// Match the sandbox's dated API and stripe-node 22.6.0. Accounts v2 is
// available in this stable release; no preview-version override is needed.
const STRIPE_API_VERSION = '2026-08-26.dahlia';
const unavailable = () => new DomainError('Sandbox payment processing is not configured', { code: 'PAYMENTS_NOT_ENABLED', status: 503 });

function stripeConfiguration(config = {}) {
  const configured = config.STRIPE_MODE === 'test' && /^sk_test_[A-Za-z0-9]+$/.test(config.STRIPE_SECRET_KEY || '');
  const enabled = configured && /^pk_test_[A-Za-z0-9]+$/.test(config.STRIPE_PUBLISHABLE_KEY || '')
    && /^whsec_[A-Za-z0-9]+$/.test(config.STRIPE_WEBHOOK_SECRET || '')
    && /^whsec_[A-Za-z0-9]+$/.test(config.STRIPE_ACCOUNT_WEBHOOK_SECRET || '');
  return { configured, enabled, mode: configured ? 'test' : 'disabled',
    publishableKey: configured && /^pk_test_[A-Za-z0-9]+$/.test(config.STRIPE_PUBLISHABLE_KEY || '') ? config.STRIPE_PUBLISHABLE_KEY : null,
    demoEnabled: !configured && (config.hostedDemo === true || ['development', 'test'].includes(config.NODE_ENV)) };
}

function createStripeClient(config = {}, { sdk } = {}) {
  if (config.STRIPE_SECRET_KEY && !/^sk_test_[A-Za-z0-9]+$/.test(config.STRIPE_SECRET_KEY)) throw unavailable();
  const configuration = stripeConfiguration(config);
  if (!configuration.configured) return null;
  const stripe = sdk || new (require('stripe'))(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 12000, maxNetworkRetries: 1 });
  const disconnect = require('./stripe-disconnect').createStripeDisconnect(stripe, config.STRIPE_CONNECT_CLIENT_ID);
  const paymentGuard = () => { if (!configuration.enabled) throw unavailable(); };
  const scope = options => {
    if (!/^acct_[A-Za-z0-9]+$/.test(options?.stripeAccount || '')) throw new DomainError('A verified merchant account is required', { code: 'PAYMENTS_NOT_READY', status: 409 });
    return options;
  };
  return {
    mode: 'test', enabled: configuration.enabled, apiVersion: STRIPE_API_VERSION,
    disconnectEnabled: disconnect.enabled, disconnectAccount: disconnect.disconnect,
    checkoutPaymentMethodOptions: { payment_method_types: ['card'] },
    createAccount: (params, options) => stripe.v2.core.accounts.create(params, options),
    retrieveAccount: id => stripe.v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'defaults', 'requirements'] }),
    createAccountLink: params => stripe.v2.core.accountLinks.create(params),
    createCheckoutSession: (params, options) => { paymentGuard(); return stripe.checkout.sessions.create(params, scope(options)); },
    retrieveCheckoutSession: (id, options) => { paymentGuard(); const { expand, ...request } = scope(options); return stripe.checkout.sessions.retrieve(id, expand ? { expand } : {}, request); },
    expireCheckoutSession: (id, options) => { paymentGuard(); return stripe.checkout.sessions.expire(id, {}, scope(options)); },
    retrieveCharge: (id, options) => { paymentGuard(); const { expand, ...request } = scope(options); return stripe.charges.retrieve(id, expand ? { expand } : {}, request); },
    createRefund: (params, options) => { paymentGuard(); return stripe.refunds.create(params, scope(options)); },
    retrieveRefund: (id, options) => { paymentGuard(); return stripe.refunds.retrieve(id, {}, scope(options)); },
    retrieveApplicationFee: (id, options = {}) => { paymentGuard(); return stripe.applicationFees.retrieve(id, options.expand ? { expand: options.expand } : {}); },
    constructWebhookEvent: (raw, signature) => { paymentGuard(); return stripe.webhooks.constructEvent(raw, signature, config.STRIPE_WEBHOOK_SECRET); },
    constructAccountNotification: (raw, signature) => { paymentGuard(); return stripe.parseEventNotification(raw, signature, config.STRIPE_ACCOUNT_WEBHOOK_SECRET); },
    retrieveAccountNotification: id => { paymentGuard(); return stripe.v2.core.events.retrieve(id); },
  };
}

module.exports = { createStripeClient, stripeConfiguration, STRIPE_API_VERSION };
