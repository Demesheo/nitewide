const { conflict, DomainError } = require('../domain/errors');

// This is server runtime policy, never a value accepted from an event draft.
function isSimulatedPaymentsRuntime({ environment, hostedDemo = false } = {}) {
  return hostedDemo === true || environment === 'development' || environment === 'test';
}

function hasPaidOfferings(offerings = []) {
  return offerings.some((offering) => offering.isActive !== false && Number(offering.priceCents) > 0);
}

function shouldRefreshPaidPublication({ event, offerings, stripe }) {
  return event.status === 'published' && hasPaidOfferings(offerings) && stripe?.enabled === true && stripe.mode === 'test';
}

async function selectedPublicationAccount({ models, event, stripe, transaction }) {
  const account = await require('./business-payment-account-service').resolveSelectedPaymentAccount({ models, event, stripe, transaction });
  if (account.paymentsDisabledAt || account.disconnectStatus && account.disconnectStatus !== 'none' || account.mode !== 'test' || !account.stripeAccountId) {
    throw conflict('The selected payment account is disabled or disconnected. Ask a business owner to connect an available account before publishing paid tiers.', 'PAYMENTS_NOT_READY');
  }
  return { id: account.id, stripeAccountId: account.stripeAccountId };
}

async function refreshPublicationAccount({ models, account, stripe, now }) {
  return require('./business-payment-account-service').synchronizeAccount(account, stripe, {
    models, now,
    providerFailure: () => new DomainError('Stripe readiness could not be checked. Your event was not saved. Try saving again from this editor.', { code: 'PAYMENTS_REFRESH_FAILED', status: 503 }),
  });
}

async function assertPaidPublication({ models, event, offerings, environment, hostedDemo, stripe, transaction, now, expectedAccount }) {
  if (event.status !== 'published' || !hasPaidOfferings(offerings) || (!stripe && isSimulatedPaymentsRuntime({ environment, hostedDemo }))) return;
  if (stripe?.enabled === true && stripe.mode === 'test') return require('./business-payment-account-service').resolvePaymentAccount({ models,event,stripe,transaction,refresh:false,now,expectedAccount,
    ...(expectedAccount ? { notReadyMessage: 'The selected account is not ready for paid sales. If you already completed Stripe onboarding, check your email for Stripe verification instructions, then try saving again here.' } : {}),
  });
  // Explicitly configured Stripe cannot fall back to simulation, including on
  // the hosted demo. Approval or browser-submitted flags are not provider proof.
  throw conflict('Paid offerings require completed Stripe onboarding and provider-confirmed payment readiness. Save a draft or publish free admission and guestlists.', 'PAYMENTS_NOT_READY');
}

module.exports = { isSimulatedPaymentsRuntime, hasPaidOfferings, shouldRefreshPaidPublication, selectedPublicationAccount, refreshPublicationAccount, assertPaidPublication };
