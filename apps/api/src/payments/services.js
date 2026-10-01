const { createStripeClient } = require('./stripe-client');
const { createBusinessPaymentAccountService } = require('../services/business-payment-account-service');
const { createStripeCheckoutService } = require('../services/stripe-checkout-service');
const { createStripeRefundService } = require('../services/stripe-refund-service');
const { createStripeWebhookService } = require('../services/stripe-webhook-service');

// The web API and worker use the same provider/domain boundary. Sandbox
// purchases deliberately do not enqueue quota-consuming transactional mail.
function createPaymentServices({ sequelize, models, config, permissions, notificationJobs, checkout, services = {} }) {
  const stripe = Object.hasOwn(services, 'stripe') ? services.stripe : createStripeClient(config);
  const paymentAccounts = services.paymentAccounts || createBusinessPaymentAccountService({ models, stripe, businessAppUrl: config.businessAppUrl });
  const paymentCheckouts = services.paymentCheckouts || createStripeCheckoutService({ sequelize, models, stripe,
    notificationJobs, checkout, email: null, customerAppUrl: config.CUSTOMER_APP_URL });
  const refunds = services.refunds || createStripeRefundService({ sequelize, models, stripe, permissions });
  const stripeWebhooks = services.stripeWebhooks || createStripeWebhookService({ sequelize, models, stripe, paymentCheckouts, paymentAccounts, refunds });
  return { stripe, paymentAccounts, paymentCheckouts, refunds, stripeWebhooks };
}
module.exports = { createPaymentServices };
