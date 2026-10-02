const { createStripeClient } = require('./stripe-client');
const { createBusinessPaymentAccountService } = require('../services/business-payment-account-service');
const { createStripeCheckoutService } = require('../services/stripe-checkout-service');
const { createStripeRefundService } = require('../services/stripe-refund-service');
const { createStripeWebhookService } = require('../services/stripe-webhook-service');
const { createCommissionLedgerService } = require('../services/commission-ledger-service');
const { createIndividualCommissionProfileService } = require('../services/individual-commission-profile-service');
const { createCommissionPaymentService } = require('../services/commission-payment-service');
const { createStripeDisputeService } = require('../services/stripe-dispute-service');

// The web API and worker use the same provider/domain boundary. Sandbox
// purchases deliberately do not enqueue quota-consuming transactional mail.
function createPaymentServices({ sequelize, models, config, permissions, notificationJobs, checkout, services = {} }) {
  const stripe = Object.hasOwn(services, 'stripe') ? services.stripe : createStripeClient(config);
  const paymentAccounts = services.paymentAccounts || createBusinessPaymentAccountService({ models, stripe, businessAppUrl: config.businessAppUrl });
  const individualCommissionProfiles = services.individualCommissionProfiles || createIndividualCommissionProfileService({ sequelize, models, stripe, customerAppUrl: config.CUSTOMER_APP_URL, businessAppUrl: config.businessAppUrl });
  const paymentCheckouts = services.paymentCheckouts || createStripeCheckoutService({ sequelize, models, stripe,
    notificationJobs, checkout, email: null, individualProfiles: individualCommissionProfiles, customerAppUrl: config.CUSTOMER_APP_URL });
  const refunds = services.refunds || createStripeRefundService({ sequelize, models, stripe, permissions });
  const commissionLedger = services.commissionLedger || createCommissionLedgerService({ sequelize, models });
  const commissionPayments = services.commissionPayments || createCommissionPaymentService({ sequelize, models, stripe, ledger: commissionLedger, individualProfiles: individualCommissionProfiles });
  const disputes = services.disputes || createStripeDisputeService({ sequelize, models, stripe, ledger: commissionLedger });
  const stripeWebhooks = services.stripeWebhooks || createStripeWebhookService({ sequelize, models, stripe, paymentCheckouts, paymentAccounts, refunds, disputes, individualCommissionProfiles, commissionPayments });
  return { stripe, paymentAccounts, paymentCheckouts, refunds, disputes, stripeWebhooks, commissionLedger, individualCommissionProfiles, commissionPayments };
}
module.exports = { createPaymentServices };
