const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPasswordRecord } = require('../src/services/auth-service');
const { createApp } = require('../src/app');
const { getConfig } = require('../src/config');
const { createStripeTestIdentity, assertOwnedSandboxAccount } = require('./sandbox-policy.cjs');
const { waitFor: poll } = require('./runtime.cjs');
const { installBrowserVerificationGate } = require('./browser-verification.cjs');

async function runPaymentFlow({ root, env, credentials, sdk, stripe, sequelize, models, account, identity, check, report, save, command, signal }) {
  const waitFor = (work, predicate, label) => poll(work, predicate, label, 30000, { signal });
  signal?.throwIfAborted();
  assertOwnedSandboxAccount(account, identity);
  const buyerIdentity = createStripeTestIdentity('api-buyer');
  const buyer = await models.User.create({ displayName: 'Sandbox Buyer', email: buyerIdentity.email, emailVerifiedAt: new Date() });
  const password = 'SyntheticSandboxPassword!2026';
  await models.UserCredential.create({ userId: buyer.id, ...await createPasswordRecord(password) });
  const owner = await models.User.create({ displayName: 'Sandbox Owner', email: identity.email, emailVerifiedAt: new Date() });
  const organization = await models.Organization.create({ name: 'Isolated sandbox merchant', slug: `sandbox-${randomUUID()}` });
  await models.OrganizationOwner.create({ organizationId: organization.id, userId: owner.id, role: 'owner' });
  const profile = await models.PaymentAccount.create({ organizationId: organization.id, name: 'API-created sandbox merchant', stripeAccountId: account.id, accountApiVersion: 'v2', mode: 'test' });
  await organization.update({ defaultPaymentAccountId: profile.id });
  const event = await models.Event.create({ organizationId: organization.id, creatorUserId: owner.id, title: 'Sandbox checkout verification',
    slug: `sandbox-${randomUUID()}`, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), status: 'published' });
  const offering = await models.Offering.create({ eventId: event.id, name: 'Sandbox General Admission', kind: 'ticket', priceCents: 2000, quantityTotal: 10 });
  // Free events remain independent of the payment readiness requirement.
  const freeEvent = await models.Event.create({ organizationId: organization.id, creatorUserId: owner.id, title: 'Sandbox free event', slug: `free-${randomUUID()}`,
    startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), status: 'published', paymentAccountId: null });
  const freeOffering = await models.Offering.create({ eventId: freeEvent.id, name: 'Free admission', kind: 'ticket', priceCents: 0, quantityTotal: 10 });
  const express = require('express');
  const harness = express();
  let server, browser, page, verificationGate;
  let attemptedOrder;
  const stage = value => { report.paymentStep = value; save(); };
  const abort = () => { browser?.close().catch(() => {}); server?.closeAllConnections(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    server = harness.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const config = getConfig({ ...env, ...credentials, CUSTOMER_APP_URL: base, BUSINESS_APP_URL: `${base}/app`, CORS_ORIGINS: base });
    const app = createApp({ sequelize, models, config, services: { stripe, email: { enabled: false, queue: async () => { throw new Error('Email must remain disabled in sandbox tests.'); } } } });
    harness.use((req, res, next) => req.path.startsWith('/api/') || req.path.startsWith('/health/') ? app(req, res, next) : next());
    const { frontendBuildEnvironment } = require('../../../e2e/environment.cjs');
    if (!process.env.npm_execpath) throw Object.assign(new Error('Use the npm command to run sandbox tests.'), { code: 'SANDBOX_NPM_REQUIRED' });
    await command([process.env.npm_execpath, 'run', 'build', '--workspace', '@nitewide/customer'], frontendBuildEnvironment(env));
    harness.use(express.static(path.join(root, 'apps/customer/dist')));
    harness.get('/', (_req, res) => res.sendFile(path.join(root, 'apps/customer/dist/index.html')));
    const request = require('supertest')(harness);
    await app.locals.payments.paymentAccounts.synchronizeTrusted(account.id);
    const free = await request.post('/api/customer/payment-checkouts').set('x-user-id', buyer.id).send({ eventId: freeEvent.id, items: [{ offeringId: freeOffering.id, quantity: 1 }], idempotencyKey: randomUUID() });
    assert.equal(free.status, 200); assert.equal(free.body.data.status, 'paid');
    check('free checkout succeeds without a Stripe charge');
    const freeTickets = await models.Ticket.count();
    const rejected = await request.post('/api/customer/payment-checkouts').set('x-user-id', buyer.id).send({ eventId: event.id, items: [{ offeringId: offering.id, quantity: 1 }], idempotencyKey: randomUUID(), payment: { status: 'succeeded' } });
    assert.equal(rejected.status, 422);
    check('HTTP checkout rejects caller-supplied payment success');

    // This is a real browser integration test of our own customer app. It is
    // not run by the default offline Playwright configuration. Never record
    // traces/HAR/video: Stripe client secrets are present in browser traffic.
    browser = await require('@playwright/test').chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York', serviceWorkers: 'block' });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.name));
    const { expect } = require('@playwright/test');
    await page.goto(base);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill(buyer.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: "Open Sandbox Buyer's profile" })).toBeVisible();
    await page.goto(`${base}/?event=${event.id}`);
    const details = page.getByTestId('customer-event-details');
    await details.getByRole('button', { name: /Sandbox General Admission/ }).click();
    await details.getByRole('button', { name: /^Continue ·/ }).click();
    const preparation = page.waitForResponse(r => r.url().endsWith('/api/customer/payment-checkouts') && r.request().method() === 'POST');
    await details.getByRole('button', { name: 'Continue to payment', exact: true }).click();
    const prepared = await (await preparation).json();
    const order = await models.Order.findByPk(prepared.data.orderId);
    attemptedOrder = order;
    report.orderId = order.id; report.sessionId = order.checkoutSessionId; report.simulatedTotalCents = order.totalCents; save();
    assert.equal(order.status, 'pending'); assert.ok(order.checkoutSessionId);
    assert.ok(order.totalCents <= 5000, 'test charge is bounded to at most $50 simulated USD');
    assert.equal(await models.Ticket.count(), freeTickets);
    const retry = await request.post('/api/customer/payment-checkouts').set('x-user-id', buyer.id).send({ eventId: event.id, items: [{ offeringId: offering.id, quantity: 1 }], idempotencyKey: order.idempotencyKey });
    assert.equal(retry.status, 200); assert.equal(retry.body.data.orderId, order.id);
    assert.equal((await sdk.checkout.sessions.list({ limit: 10 }, { stripeAccount: account.id })).data.filter(s => s.metadata?.orderId === order.id).length, 1);
    check('checkout retry retains exactly one provider session and reserves without issuing paid admissions');
    verificationGate = await installBrowserVerificationGate(page, { base, orderId: order.id });
    stage('payment-frame-card-number');
    // Stripe may nest its card fields below the titled Payment Element frame.
    // Find the actual Stripe-hosted field frame by its accessible card label.
    const cardFrame = await waitFor(async () => {
      const candidates = [];
      for (const frame of page.frames()) {
        try {
          if (new URL(frame.url()).hostname === 'js.stripe.com' && await frame.getByLabel('Card number', { exact: true }).count() === 1) candidates.push(frame);
        } catch { /* Ignore frames replaced while Elements loads. */ }
      }
      assert.ok(candidates.length <= 1, 'Only one Stripe card form should be mounted.');
      return candidates[0];
    }, frame => Boolean(frame), 'Stripe card input frame');
    await cardFrame.getByLabel('Card number', { exact: true }).fill('4242424242424242');
    stage('payment-frame-expiration');
    await cardFrame.getByRole('textbox', { name: /Expiration|Expiry|MM\s*\/\s*YY/i }).fill('1234');
    stage('payment-frame-security-code');
    await cardFrame.getByRole('textbox', { name: 'Security code', exact: true }).fill('123');
    const postal = cardFrame.getByLabel(/ZIP|Postal code/i);
    if (await postal.count()) await postal.fill('12345');
    stage('payment-submit');
    await details.getByRole('button', { name: /^Pay / }).click();
    stage('payment-precheck');
    await waitFor(() => verificationGate.ready(), ready => ready, 'genuine pre-payment verification');
    report.browserVerification = verificationGate.snapshot(); save();
    check('the real browser pre-payment check independently confirms the exact order is pending');
    stage('provider-payment-confirmation');
    const session = await waitFor(() => stripe.retrieveCheckoutSession(order.checkoutSessionId, { stripeAccount: account.id, expand: ['payment_intent.latest_charge'] }), s => s.status === 'complete' && s.payment_status === 'paid', 'Stripe payment confirmation');
    assert.equal(session.livemode, false);
    await waitFor(() => verificationGate.snapshot().blockedRequests, count => count > 0, 'post-confirmation browser verification');
    report.browserVerification = verificationGate.snapshot(); save();
    assert.equal((await order.reload()).status, 'pending'); assert.equal(await models.Ticket.count(), freeTickets);
    check('Stripe Elements confirms one simulated direct charge; no admission before server verification');
    stage('payment-webhook-replay');
    report.orderId = order.id; report.sessionId = session.id; report.paymentIntentId = session.payment_intent.id; report.simulatedTotalCents = order.totalCents; save();
    const eventEvidence = await waitFor(() => sdk.events.list({ type: 'checkout.session.completed', limit: 10 }, { stripeAccount: account.id }), events => events.data.some(e => e.data.object.id === session.id), 'Stripe checkout completion event');
    const completion = eventEvidence.data.find(e => e.data.object.id === session.id);
    assert.equal(completion.livemode, false);
    // Stripe-account context is added to the replay envelope when scoped event
    // retrieval omits it. These are local test signatures, not delivery proof.
    const body = JSON.stringify({ ...completion, account: account.id });
    const signed = secret => sdk.webhooks.generateTestHeaderString({ payload: body, secret });
    const forged = await request.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed('whsec_wrong')).send(body);
    assert.equal(forged.status, 400); assert.equal(await models.Ticket.count(), freeTickets);
    const received = await request.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed(credentials.STRIPE_WEBHOOK_SECRET)).send(body);
    assert.equal(received.status, 200); assert.equal((await order.reload()).status, 'paid');
    assert.equal(await models.Ticket.count(), freeTickets + 1);
    const replay = await request.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signed(credentials.STRIPE_WEBHOOK_SECRET)).send(body);
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    assert.equal(await models.Ticket.count(), freeTickets + 1);
    check('retrieved real Stripe event passes raw-body HTTP signature checks and duplicate delivery issues admission once');
    stage('customer-pass-recovery');
    await verificationGate.release();
    // Pay's recovery precheck opens already-paid passes without reconfirming.
    await details.getByRole('button', { name: /^Pay / }).click();
    await expect(page).toHaveURL(new RegExp(`booking=purchase(?:%3A|:)${order.id}`));
    await expect(page.getByRole('img', { name: /QR code for ticket 1/ })).toBeVisible();
    assert.deepEqual(runtimeErrors, []);
    check('customer recovery opens exact QR passes after verified webhook fulfillment');
    stage('application-fee-evidence');
    const paidOrder = await order.reload();
    const charge = await sdk.charges.retrieve(paidOrder.stripeChargeId, { expand: ['balance_transaction'] }, { stripeAccount: account.id });
    const feeId = typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id;
    assert.ok(feeId, 'the direct charge must collect a Nitewide application fee');
    const fee = await waitFor(() => stripe.retrieveApplicationFee(feeId), value => Boolean(value.balance_transaction), 'application fee balance transaction');
    const balanceId = typeof fee.balance_transaction === 'string' ? fee.balance_transaction : fee.balance_transaction.id;
    const platformTransaction = await sdk.balanceTransactions.retrieve(balanceId);
    report.feeEvidence = require('./application-fee-check.cjs').verifyApplicationFeeEvidence(paidOrder, account.id, charge, fee, platformTransaction);
    save();
    check('actual Stripe application fee and merchant/Nitewide balance transactions match the server quote');
    stage('full-refund');
    const refundKey = randomUUID();
    const refund = await request.post(`/api/business/orders/${order.id}/refunds`).set('x-user-id', owner.id).send({ reason: 'Synthetic sandbox full-refund regression', idempotencyKey: refundKey });
    assert.equal(refund.status, 200);
    await waitFor(() => app.locals.payments.refunds.sweepPendingRefunds(), async () => (await order.reload()).status === 'refunded', 'full refund reconciliation');
    assert.equal((await order.reload()).status, 'refunded');
    const paidItems = await models.OrderItem.findAll({ where: { orderId: order.id } });
    assert.equal(await models.Ticket.count({ where: { orderItemId: paidItems.map(i => i.id), status: 'void' } }), 1);
    assert.equal(await models.EmailOutbox.count(), 0);
    check('full customer payment and application fee refund are provider verified and admission is voided; zero Resend messages');
    delete report.paymentStep; save();
  } catch (error) {
    if (verificationGate) { report.browserVerification = verificationGate.snapshot(); save(); }
    // Record only form structure, never field values, URLs or response bodies.
    if (page && !page.isClosed()) {
      const frames = [];
      for (const frame of page.frames()) {
        try {
          const origin = new URL(frame.url()).origin;
          if (!/^https:\/\/([a-z0-9.-]+\.)?stripe\.com$/i.test(origin)) continue;
          frames.push({ origin, inputs: await frame.locator('input').evaluateAll(inputs => inputs.map(input => ({
            name: input.name, type: input.type, label: input.getAttribute('aria-label'), placeholder: input.getAttribute('placeholder'),
          }))) });
        } catch { /* A detached provider frame should not mask the failure. */ }
      }
      report.browserDiagnostics = { frameTitles: await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.title)), frames };
      save();
    }
    throw error;
  } finally {
    if (attemptedOrder) {
      try {
        report.providerCleanup = await require('./payment-cleanup.cjs').cleanupSandboxAttempt({ sdk, accountId: account.id,
          orderId: attemptedOrder.id, sessionId: attemptedOrder.checkoutSessionId });
      } catch (error) {
        report.providerCleanupFailure = require('./sandbox-policy.cjs').safeFailure(error);
      }
      save();
    }
    signal?.removeEventListener('abort', abort);
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}

module.exports = { runPaymentFlow };
