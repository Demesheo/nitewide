const { conflict } = require('../domain/errors');

// This is server runtime policy, never a value accepted from an event draft.
function isSimulatedPaymentsRuntime({ environment, hostedDemo = false } = {}) {
  return hostedDemo === true || environment === 'development' || environment === 'test';
}

function hasPaidOfferings(offerings = []) {
  return offerings.some((offering) => offering.isActive !== false && Number(offering.priceCents) > 0);
}

async function assertPaidPublication({ models, event, offerings, environment, hostedDemo, stripe, transaction }) {
  if (event.status !== 'published' || !hasPaidOfferings(offerings) || (!stripe && isSimulatedPaymentsRuntime({ environment, hostedDemo }))) return;
  if (stripe?.enabled === true && stripe.mode === 'test') return require('./business-payment-account-service').resolvePaymentAccount({ models,event,stripe,transaction,refresh:false });
  // Explicitly configured Stripe cannot fall back to simulation, including on
  // the hosted demo. Approval or browser-submitted flags are not provider proof.
  throw conflict('Paid offerings require completed Stripe onboarding and provider-confirmed payment readiness. Save a draft or publish free admission and guestlists.', 'PAYMENTS_NOT_READY');
}

module.exports = { isSimulatedPaymentsRuntime, hasPaidOfferings, assertPaidPublication };
