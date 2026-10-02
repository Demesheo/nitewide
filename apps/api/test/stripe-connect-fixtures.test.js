const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../../../e2e/test-data/stripe-connect/us-sandbox.json');
const { createStripeTestIdentity } = require('../../../e2e/test-data/stripe-connect/identity.cjs');
const { providerState, paymentsReady, RESPONSIBILITIES } = require('../src/services/business-payment-account-service');
const { offlineEnvironment } = require('../scripts/test-database.cjs');

test('Connect test data is source-linked, synthetic and includes an offline identity image', () => {
  assert.equal(data.source, 'https://docs.stripe.com/connect/testing');
  assert.equal(data.sandboxOnly, true);
  assert.equal(data.country, 'US');
  assert.equal(data.email, 'test@nitewide.com');
  assert.equal(data.emailIsVerificationToken, false);
  assert.equal(data.identity.documentSuccessToken, 'file_identity_document_success');
  assert.match(data.identity.birthDateSuccess, /^1901-/);
  const image = fs.readFileSync(path.resolve(__dirname, '../../../e2e/test-data/stripe-connect', data.identity.documentSuccessImage));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 64);
  assert.equal(image.readUInt32BE(20), 64);
  const offline = offlineEnvironment({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_ambient', RESEND_API_KEY: 'ambient' });
  assert.equal(offline.STRIPE_MODE, 'disabled');
  assert.equal(offline.STRIPE_SECRET_KEY, '');
  assert.equal(offline.RESEND_API_KEY, '');
});

test('each sandbox test gets a generated labeled Nitewide email, with the client-local date', () => {
  const now = new Date('2026-10-02T01:00:00Z'); // Still October 1 in New York.
  const identities = Array.from({ length: 100 }, () => createStripeTestIdentity('Connect onboarding', now));
  assert.equal(new Set(identities.map(value => value.email)).size, 100);
  for (const identity of identities) {
    assert.match(identity.testIdentifier, /^connect-onboarding-20261001-[a-f0-9]{12}$/);
    assert.equal(identity.email, `test+${identity.testIdentifier}@nitewide.com`);
    assert.ok(identity.email.split('@')[0].length <= 64);
    assert.equal(identity.email.includes('$'), false);
  }
  assert.match(createStripeTestIdentity('   ').email, /^test\+connect-test-/);
});

test('successful test inputs or form completion cannot replace verified provider capabilities', () => {
  const remote = { id: 'acct_fixture', object: 'v2.core.account', livemode: false, dashboard: 'full', applied_configurations: ['merchant'],
    defaults: { responsibilities: { ...RESPONSIBILITIES, requirements_collector: 'stripe' } },
    configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'restricted' } } } },
    requirements: { entries: [] }, metadata: { test_email: data.email, identity_document: data.identity.documentSuccessToken, form_completed: 'true' } };
  const profile = { accountApiVersion: 'v2', stripeAccountId: remote.id, mode: 'test', lifecycleState: 'active' };
  assert.equal(paymentsReady({ ...profile, ...providerState(remote, remote.id) }), false);
  remote.configuration.merchant.capabilities.card_payments.status = 'active';
  assert.equal(paymentsReady({ ...profile, ...providerState(remote, remote.id) }), true);
  remote.requirements.entries.push({ description: 'identity.individual.documents.primary_verification', minimum_deadline: { status: 'currently_due' }, awaiting_action_from: 'user' });
  assert.equal(paymentsReady({ ...profile, ...providerState(remote, remote.id) }), false);
});
