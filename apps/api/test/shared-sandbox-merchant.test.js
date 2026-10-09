const test = require('node:test');
const assert = require('node:assert/strict');
const { sharedSandboxAccountId, sharedSandboxOrderMatches } = require('../src/domain/shared-sandbox-merchant');
const { getConfig } = require('../src/config');
const { createStripeClient } = require('../src/payments/stripe-client');
const { offlineEnvironment } = require('../scripts/test-database.cjs');

const config = { NODE_ENV:'development', STRIPE_MODE:'test', STRIPE_SECRET_KEY:'sk_test_mock', STRIPE_PUBLISHABLE_KEY:'pk_test_mock',
  STRIPE_WEBHOOK_SECRET:'whsec_mock', STRIPE_ACCOUNT_WEBHOOK_SECRET:'whsec_accountmock', STRIPE_SANDBOX_SHARED_ACCOUNT_ID:'acct_shared' };

test('shared merchant routing is explicit, sandbox only, and never valid for ordinary production', () => {
  assert.equal(sharedSandboxAccountId({}),null);
  for (const STRIPE_SECRET_KEY of ['sk_test_mock', 'rk_test_mock']) {
    const current = { ...config, STRIPE_SECRET_KEY };
    for (const NODE_ENV of ['development','test']) assert.equal(sharedSandboxAccountId({...current,NODE_ENV}),'acct_shared');
    assert.equal(sharedSandboxAccountId({...current,NODE_ENV:'production',HOSTED_DEMO:'true'}),'acct_shared');
    assert.equal(sharedSandboxAccountId({...current,NODE_ENV:'production',hostedDemo:true}),'acct_shared');
    assert.equal(getConfig(current).STRIPE_SANDBOX_SHARED_ACCOUNT_ID,'acct_shared');
    assert.equal(createStripeClient(current, { sdk: {} }).sandboxSharedAccountId, 'acct_shared');
  }
  for (const changes of [{NODE_ENV:'production'},{NODE_ENV:'production',hostedDemo:false},{NODE_ENV:'staging'},
    {STRIPE_MODE:'disabled'},{STRIPE_MODE:'live'},{STRIPE_SECRET_KEY:'sk_live_mock'},{STRIPE_SECRET_KEY:'rk_live_mock'},
    {STRIPE_SECRET_KEY:'pk_test_mock'},{STRIPE_SECRET_KEY:'rk_test_'},{STRIPE_SANDBOX_SHARED_ACCOUNT_ID:'acct_bad/route'}]) {
    assert.throws(()=>sharedSandboxAccountId({...config,...changes}));
    assert.throws(()=>createStripeClient({...config,...changes},{sdk:{}}));
  }
  assert.equal(getConfig(config).STRIPE_SANDBOX_SHARED_ACCOUNT_ID,'acct_shared');
  assert.throws(()=>getConfig({...config,NODE_ENV:'production',CUSTOMER_APP_URL:'https://customer.example',BUSINESS_APP_URL:'https://business.example/'}),/shared sandbox merchant/i);
});

test('shared routing does not override scope on historical provider retrievals or refunds', () => {
  const calls=[];
  const sdk={checkout:{sessions:{retrieve:(...args)=>calls.push(['checkout',...args])}},
    refunds:{create:(...args)=>calls.push(['refund',...args])}};
  const stripe=createStripeClient(config,{sdk});
  assert.equal(stripe.sandboxSharedAccountId,'acct_shared');
  stripe.retrieveCheckoutSession('cs_original',{stripeAccount:'acct_original'});
  stripe.createRefund({amount:2000},{stripeAccount:'acct_original',idempotencyKey:'same'});
  assert.deepEqual(calls,[['checkout','cs_original',{}, {stripeAccount:'acct_original'}],
    ['refund',{amount:2000},{stripeAccount:'acct_original',idempotencyKey:'same'}]]);
});

test('shared checkout reconciliation requires the original server-owned merchant binding in test mode', () => {
  const account={id:'profile',stripeAccountId:'acct_shared'},event={organizationId:'business'};
  const order={providerMode:'test',pricingPlanSnapshot:{merchant:{organizationId:'business',paymentAccountId:'profile',stripeAccountId:'acct_shared',sharedSandbox:true}}};
  assert.equal(sharedSandboxOrderMatches(order,account,event),true);
  for (const merchant of [{sharedSandbox:false},{sharedSandbox:'true'},{organizationId:'different'},{paymentAccountId:'foreign'},{stripeAccountId:'acct_foreign'}]) {
    assert.equal(sharedSandboxOrderMatches({...order,pricingPlanSnapshot:{merchant:{...order.pricingPlanSnapshot.merchant,...merchant}}},account,event),false);
  }
  assert.equal(sharedSandboxOrderMatches({...order,providerMode:'live'},account,event),false);
  assert.equal(sharedSandboxOrderMatches({...order,pricingPlanSnapshot:{}},account,event),false);
});

test('ordinary automated tests scrub the shared merchant setting with all Stripe credentials', () => {
  const environment=offlineEnvironment(config);
  assert.equal(environment.STRIPE_SANDBOX_SHARED_ACCOUNT_ID,'');
  assert.equal(getConfig(environment).STRIPE_SANDBOX_SHARED_ACCOUNT_ID,undefined);
  assert.equal(offlineEnvironment({}).STRIPE_SANDBOX_SHARED_ACCOUNT_ID,'','child dotenv loads cannot restore an ambient shared merchant setting');
});
