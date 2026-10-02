const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { getConfig } = require('../src/config');
const { assertOwnedSandboxAccount, verifiedReadiness } = require('./sandbox-policy.cjs');
const { waitFor } = require('./runtime.cjs');

async function checkAccountWebhook({ env, credentials, sdk, stripe, sequelize, models, account, identity, check, signal }) {
  signal?.throwIfAborted();
  const org = await models.Organization.create({ name: 'Sandbox webhook scope', slug: `sandbox-hook-${randomUUID()}` });
  const profile = await models.PaymentAccount.create({ organizationId: org.id, name: 'Sandbox webhook profile', stripeAccountId: account.id, mode: 'test', accountApiVersion: 'v2' });
  const app = createApp({ sequelize, models, config: getConfig({ ...env, ...credentials }), services: { stripe,
    email: { enabled: false, queue: async () => { throw new Error('Sandbox email is disabled.'); } } } });
  const request = require('supertest')(app);
  const marker = randomUUID();
  // Only mutate metadata on OUR newly tagged test merchant. No role, banking,
  // capabilities, dashboard model or deployed application records are changed.
  const before = new Set((await sdk.v2.core.events.list({ object_id: account.id, types: ['v2.core.account.updated'], limit: 20 })).data.map(e => e.id));
  const updated = await sdk.v2.core.accounts.update(account.id, { metadata: { ...account.metadata, nitewide_test_probe: marker } });
  assert.equal(updated.livemode, false);
  const events = await waitFor(() => sdk.v2.core.events.list({ object_id: account.id, types: ['v2.core.account.updated'], limit: 20 }),
    result => result.data.some(e => e.related_object?.id === account.id && !before.has(e.id)), 'Account update event', 30000, { signal });
  const event = events.data.find(e => e.related_object?.id === account.id && !before.has(e.id));
  assert.equal(event.livemode, false);
  const body = JSON.stringify({ id: event.id, object: event.object, type: event.type, created: event.created, livemode: false, related_object: event.related_object });
  const signature = secret => sdk.webhooks.generateTestHeaderString({ payload: body, secret });
  const send = secret => request.post('/api/webhooks/stripe/accounts').set('Content-Type', 'application/json').set('Stripe-Signature', signature(secret)).send(body);
  assert.equal((await send('whsec_wrong')).status, 400);
  assert.equal(await models.StripeWebhookReceipt.count(), 0);
  const received = await send(credentials.STRIPE_ACCOUNT_WEBHOOK_SECRET);
  assert.equal(received.status, 200);
  assert.equal((await send(credentials.STRIPE_ACCOUNT_WEBHOOK_SECRET)).body.replayed, true);
  assert.equal(await models.StripeWebhookReceipt.count(), 1);
  const remote = assertOwnedSandboxAccount(await stripe.retrieveAccount(account.id), identity);
  const saved = await profile.reload();
  assert.equal(saved.controllerMatches, true);
  assert.equal(saved.chargesEnabled, remote.configuration.merchant.capabilities.card_payments.status === 'active');
  assert.equal(saved.detailsSubmitted && saved.chargesEnabled, verifiedReadiness(remote));
  assert.equal(await models.EmailOutbox.count(), 0);
  check('real account-update event replays through signed thin HTTP webhook, verifies provider readiness and deduplicates');
  // Release the temporary profile's unique Stripe ID for the checkout fixture.
  await profile.update({ stripeAccountId: null, lifecycleState: 'archived' });
  return remote;
}

module.exports = { checkAccountWebhook };
