const { randomBytes } = require('node:crypto');
const fixtures = require('../../../e2e/test-data/stripe-connect/us-sandbox.json');
const { createStripeTestIdentity } = require('../../../e2e/test-data/stripe-connect/identity.cjs');
const { STRIPE_API_VERSION } = require('../src/payments/stripe-client');
const { controllerMatches, providerState, paymentsReady, RESPONSIBILITIES } = require('../src/services/business-payment-account-service');

function assertSandboxInvocation(args, environment) {
  if (args[0] !== '--run' || !(args.length === 1 || args.length === 3 && args[1] === '--resume' && /^api-onboarding-\d{8}-[a-f0-9]{12}$/.test(args[2]))) throw new Error('Invoke explicitly with npm run test:stripe:sandbox, optionally -- --resume <test identifier>.');
  if (environment.CI && environment.CI !== 'false') throw new Error('Real Stripe sandbox tests are not allowed in CI, build or deployment jobs.');
  if (environment.NODE_ENV === 'production' || environment.HOSTED_DEMO === 'true') throw new Error('Run sandbox tests locally, not inside an application deployment.');
  if (environment.STRIPE_MODE !== 'test' || !/^sk_test_[A-Za-z0-9]+$/.test(environment.STRIPE_SECRET_KEY || '')
    || !/^pk_test_[A-Za-z0-9]+$/.test(environment.STRIPE_PUBLISHABLE_KEY || '')) throw new Error('Configure STRIPE_MODE=test and matching sandbox secret/publishable keys in local .env. Live keys are forbidden.');
}

function sandboxCredentials(environment) {
  return { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: environment.STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY: environment.STRIPE_PUBLISHABLE_KEY,
    // This private local receiver replays retrieved Stripe events. It never
    // uses or changes the developer's deployed destination signing secrets.
    STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString('hex')}`,
    STRIPE_ACCOUNT_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString('hex')}` };
}

function accountParameters(identity) {
  if (!/^test\+[a-z0-9-]+@nitewide\.com$/.test(identity.email)) throw new Error('Sandbox accounts require a generated test identity.');
  return { display_name: `Nitewide sandbox ${identity.testIdentifier}`, contact_email: identity.email,
    dashboard: 'full', defaults: { currency: 'usd', responsibilities: RESPONSIBILITIES,
      profile: { business_url: fixtures.business.websiteSuccess, product_description: 'Synthetic event tickets for Nitewide sandbox integration testing.' } },
    configuration: { merchant: { mcc: '7922', capabilities: { card_payments: { requested: true } } } },
    identity: { country: 'us', entity_type: 'individual',
      individual: { given_name: 'Jenny', surname: 'Rosen', email: identity.email, phone: fixtures.business.phoneSuccess,
        date_of_birth: { year: 1902, month: 1, day: 1 },
        address: { line1: fixtures.business.addressSuccess, city: 'Schenectady', state: 'NY', postal_code: '12345', country: 'US' },
        id_numbers: [{ type: 'us_ssn_last_4', value: fixtures.identity.ssnLast4Success }] } },
    metadata: { nitewide_sandbox_test: 'true', nitewide_test_identifier: identity.testIdentifier },
    include: ['identity', 'configuration.merchant', 'defaults', 'requirements'] };
}

function assertOwnedSandboxAccount(account, identity) {
  if (!/^acct_[A-Za-z0-9]+$/.test(account?.id || '') || account.livemode !== false || !controllerMatches(account)
    || account.metadata?.nitewide_sandbox_test !== 'true' || account.metadata?.nitewide_test_identifier !== identity.testIdentifier) {
    throw new Error('Refusing a live, untagged or differently configured connected account.');
  }
  return account;
}

function verifiedReadiness(account) {
  return paymentsReady({ stripeAccountId: account.id, mode: 'test', lifecycleState: 'active', ...providerState(account, account.id) });
}

function safeFailure(error) {
  // Stripe errors can contain request params, keys, URLs and client secrets.
  // Return allowlisted diagnostic labels, never message/stack/raw response.
  const label = value => /^[a-zA-Z0-9_.-]{1,120}$/.test(value || '') ? value : null;
  return { type: label(error?.type || error?.name) || 'Error', code: label(error?.code) || 'SANDBOX_TEST_FAILED',
    ...(/^[a-zA-Z0-9_.\[\]-]{1,120}$/.test(error?.param || '') ? { parameter: error.param } : {}),
    ...(Number.isInteger(error?.statusCode) ? { httpStatus: error.statusCode } : {}) };
}

module.exports = { assertSandboxInvocation, sandboxCredentials, accountParameters, assertOwnedSandboxAccount, verifiedReadiness,
  safeFailure, createStripeTestIdentity, fixtures, STRIPE_API_VERSION };
