const { DomainError } = require('../domain/errors');
const { sharedSandboxAccountId } = require('../domain/shared-sandbox-merchant');
const { validateStripeSettings } = require('./stripe-settings');
const { isStripeMode } = require('./stripe-mode');
const { stripePublishableKeyMode } = require('./stripe-keys');

// Match the dated API and stripe-node 22.6.0. Accounts v2 is
// available in this stable release; no preview-version override is needed.
const STRIPE_API_VERSION = '2026-08-26.dahlia';
const unavailable = () => new DomainError('Payment processing is not configured', { code: 'PAYMENTS_NOT_ENABLED', status: 503 });

function stripeConfiguration(config = {}) {
  let valid = true;
  try { validateStripeSettings(config); } catch { valid = false; }
  const configured = valid && isStripeMode(config.STRIPE_MODE);
  const publishableKeyMatches = isStripeMode(config.STRIPE_MODE)
    && stripePublishableKeyMode(config.STRIPE_PUBLISHABLE_KEY) === config.STRIPE_MODE;
  const enabled = configured && publishableKeyMatches
    && /^whsec_[A-Za-z0-9]+$/.test(config.STRIPE_WEBHOOK_SECRET || '')
    && /^whsec_[A-Za-z0-9]+$/.test(config.STRIPE_ACCOUNT_WEBHOOK_SECRET || '');
  return { configured, enabled, mode: configured ? config.STRIPE_MODE : 'disabled',
    publishableKey: configured && publishableKeyMatches ? config.STRIPE_PUBLISHABLE_KEY : null,
    demoEnabled: valid && (config.STRIPE_MODE ?? 'disabled') === 'disabled'
      && (config.hostedDemo === true || ['development', 'test'].includes(config.NODE_ENV)) };
}

function createStripeClient(config = {}, { sdk } = {}) {
  const sandboxSharedAccountId = sharedSandboxAccountId(config);
  try { validateStripeSettings(config); } catch { throw unavailable(); }
  const configuration = stripeConfiguration(config);
  if (!configuration.configured) return null;
  const stripe = sdk || new (require('stripe'))(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 12000, maxNetworkRetries: 1 });
  const disconnect = require('./stripe-disconnect').createStripeDisconnect(stripe, config.STRIPE_CONNECT_CLIENT_ID, configuration.mode);
  const paymentGuard = () => { if (!configuration.enabled) throw unavailable(); };
  const scope = options => {
    if (!/^acct_[A-Za-z0-9]+$/.test(options?.stripeAccount || '')) throw new DomainError('A verified merchant account is required', { code: 'PAYMENTS_NOT_READY', status: 409 });
    return options;
  };
  const retrievePaymentIntent = (id, options) => { paymentGuard(); return stripe.paymentIntents.retrieve(id, {}, scope(options)); };
  return {
    mode: configuration.mode, enabled: configuration.enabled, apiVersion: STRIPE_API_VERSION, sandboxSharedAccountId,
    disconnectEnabled: disconnect.enabled, disconnectAccount: disconnect.disconnect,
    // Explicit allowlist: cards (including Apple Pay/Google Pay) plus Link.
    // Link controls funding choices internally; no separate bank/BNPL method.
    // PayPal is unsupported for our US Connect direct-charge architecture.
    checkoutPaymentMethodOptions: { payment_method_types: ['card', 'link'], wallet_options: { link: { display: 'auto' } } },
    createAccount: (params, options) => stripe.v2.core.accounts.create(params, options),
    retrieveAccount: id => stripe.v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'defaults', 'requirements'] }),
    retrieveIndividualAccount: id => stripe.v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'defaults', 'requirements', 'identity'] }),
    createAccountLink: params => stripe.v2.core.accountLinks.create(params),
    createCheckoutSession: (params, options) => { paymentGuard(); return stripe.checkout.sessions.create(params, scope(options)); },
    retrieveCheckoutSession: (id, options) => { paymentGuard(); const { expand, ...request } = scope(options); return stripe.checkout.sessions.retrieve(id, expand ? { expand } : {}, request); },
    expireCheckoutSession: (id, options) => { paymentGuard(); return stripe.checkout.sessions.expire(id, {}, scope(options)); },
    retrieveCharge: (id, options) => { paymentGuard(); const { expand, ...request } = scope(options); return stripe.charges.retrieve(id, expand ? { expand } : {}, request); },
    retrievePaymentIntent,
    createCommissionCustomer: (params, options) => { paymentGuard(); return stripe.customers.create(params, scope(options)); },
    retrieveCommissionCustomer: (id, options) => { paymentGuard(); return stripe.customers.retrieve(id, {}, scope(options)); },
    createCommissionInvoice: (params, options) => { paymentGuard(); return stripe.invoices.create(params, scope(options)); },
    createCommissionInvoiceItem: (params, options) => { paymentGuard(); return stripe.invoiceItems.create(params, scope(options)); },
    finalizeCommissionInvoice: (id, params, options) => { paymentGuard(); return stripe.invoices.finalizeInvoice(id, params, scope(options)); },
    voidCommissionInvoice: (id, options) => { paymentGuard(); return stripe.invoices.voidInvoice(id, {}, scope(options)); },
    retrieveCommissionInvoice: (id, options) => { paymentGuard(); return stripe.invoices.retrieve(id, {}, scope(options)); },
    listCommissionInvoiceLines: (id, options, { startingAfter } = {}) => { paymentGuard(); return stripe.invoices.listLineItems(id, { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }, scope(options)); },
    listCommissionInvoicePayments: (id, options) => { paymentGuard(); return stripe.invoicePayments.list({ invoice: id, limit: 100 }, scope(options)); },
    retrieveCommissionPaymentIntent: retrievePaymentIntent,
    retrieveCommissionBalanceTransaction: (id, options) => { paymentGuard(); return stripe.balanceTransactions.retrieve(id, {}, scope(options)); },
    listCommissionFeeTransactions: (id, options) => { paymentGuard(); return stripe.balanceTransactions.list({ source: id, limit: 100 }, scope(options)); },
    retrieveCommissionDispute: (id, options) => { paymentGuard(); return stripe.disputes.retrieve(id, {}, scope(options)); },
    retrieveDispute: (id, options) => { paymentGuard(); return stripe.disputes.retrieve(id, {}, scope(options)); },
    createRefund: (params, options) => { paymentGuard(); return stripe.refunds.create(params, scope(options)); },
    retrieveRefund: (id, options) => { paymentGuard(); return stripe.refunds.retrieve(id, {}, scope(options)); },
    retrieveApplicationFee: (id, options = {}) => { paymentGuard(); return stripe.applicationFees.retrieve(id, options.expand ? { expand: options.expand } : {}); },
    constructWebhookEvent: (raw, signature) => { paymentGuard(); return stripe.webhooks.constructEvent(raw, signature, config.STRIPE_WEBHOOK_SECRET); },
    constructAccountNotification: (raw, signature) => { paymentGuard(); return stripe.parseEventNotification(raw, signature, config.STRIPE_ACCOUNT_WEBHOOK_SECRET); },
    retrieveAccountNotification: id => { paymentGuard(); return stripe.v2.core.events.retrieve(id); },
  };
}

module.exports = { createStripeClient, stripeConfiguration, STRIPE_API_VERSION };
