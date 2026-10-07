const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createSequelize } = require('../src/db/sequelize');
const { initModels } = require('../src/db/models');
const { createCheckoutService } = require('../src/services/checkout-service');
const { createStripeCheckoutService } = require('../src/services/stripe-checkout-service');
const { createStripeWebhookService } = require('../src/services/stripe-webhook-service');
const { createStripeRefundService } = require('../src/services/stripe-refund-service');
const { createPermissionService } = require('../src/services/permission-service');
const {createBusinessPaymentAccountService}=require('../src/services/business-payment-account-service');
const {createBusinessPaymentDisconnectService}=require('../src/services/business-payment-disconnect-service');

function mockProvider(namespace = '') {
  const sessions = new Map(), keys = new Map(), refunds = new Map(), charges = new Map(), fees = new Map(), thinEvents = new Map();
  let unavailable = false, loseCreationResponse = false, loseRefundResponse = false, creations = 0, refundCreations = 0, refundRequests = 0;
  let refundResponseGate, executingRefundGate;
  const check = () => { if (unavailable) throw new Error('Provider transport unavailable'); };
  const scoped = (session, options) => { assert.equal(options.stripeAccount, session.account); return structuredClone(session); };
  const paymentOptions = require('../src/payments/stripe-client').createStripeClient({ STRIPE_MODE:'test', STRIPE_SECRET_KEY:'sk_test_mock', STRIPE_PUBLISHABLE_KEY:'pk_test_mock', STRIPE_WEBHOOK_SECRET:'whsec_mock', STRIPE_ACCOUNT_WEBHOOK_SECRET:'whsec_mock' }, { sdk:{} }).checkoutPaymentMethodOptions;
  const stripe = { enabled: true, mode: 'test', checkoutPaymentMethodOptions: paymentOptions,
    retrieveAccount: async id => ({ id, object: 'v2.core.account', livemode: false, applied_configurations: ['merchant'], dashboard: 'full',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } }),
    createCheckoutSession: async (params, options) => {
      check(); if (keys.has(options.idempotencyKey)) return scoped(sessions.get(keys.get(options.idempotencyKey)), options);
      const id = `cs_${namespace}${++creations}`, session = { id, account: options.stripeAccount, client_secret: `${id}_secret`, livemode: false,
        mode: params.mode, status: 'open', payment_status: 'unpaid', metadata: params.metadata, client_reference_id: params.client_reference_id,
        amount_total: params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0), currency: params.line_items[0].price_data.currency,
        fee: params.payment_intent_data.application_fee_amount, params };
      assert.equal(params.ui_mode, 'elements'); assert.deepEqual(params.payment_method_types, ['card', 'link']);
      assert.deepEqual(params.wallet_options, { link: { display: 'auto' } });
      assert.equal('allowed_payment_method_types' in params, false); assert.equal('transfer_data' in params.payment_intent_data, false);
      sessions.set(id, session); keys.set(options.idempotencyKey, id);
      if (loseCreationResponse) { loseCreationResponse = false; throw new Error('Response lost after provider creation'); }
      return scoped(session, options);
    },
    retrieveCheckoutSession: async (id, options) => { check(); return scoped(sessions.get(id), options); },
    expireCheckoutSession: async (id, options) => { check(); const session = sessions.get(id); scoped(session, options); if (session.payment_status === 'paid') throw new Error('Already paid'); session.status = 'expired'; return structuredClone(session); },
    constructWebhookEvent: (raw, signature) => { if (signature !== 'verified-signature') throw new Error('Bad signature'); return JSON.parse(raw.toString()); },
    constructAccountNotification: (raw, signature) => { if (signature !== 'verified-thin-signature') throw new Error('Bad thin signature'); return JSON.parse(raw.toString()); },
    retrieveAccountNotification: async id => structuredClone(thinEvents.get(id)),
    createRefund: async (params, options) => {
      refundRequests++;
      check(); const key = `refund:${options.idempotencyKey}`;
      if (keys.has(key)) {
        if (executingRefundGate?.key === key && executingRefundGate.idempotencyInUse) throw new Error('Stripe idempotency key is still in use');
        return structuredClone(refunds.get(keys.get(key)));
      }
      assert.equal(params.refund_application_fee, true); assert.equal('reverse_transfer' in params, false);
      const charge = [...charges.values()].find(value => value.payment_intent === params.payment_intent);
      assert.equal(options.stripeAccount, charge.account);
      const id = `re_${namespace}${++refundCreations}`, refund = { id, livemode: false, status: 'succeeded', amount: params.amount, currency: charge.currency,
        payment_intent: params.payment_intent, charge: charge.id, metadata: params.metadata };
      charge.refunded = true; charge.amount_refunded = params.amount;
      const fee = fees.get(charge.application_fee); fee.refunded = true; fee.amount_refunded = fee.amount;
      refunds.set(id, refund); keys.set(key, id);
      if (refundResponseGate) {
        const gate = refundResponseGate; refundResponseGate = undefined;
        executingRefundGate = { key, idempotencyInUse: gate.idempotencyInUse };
        gate.executed(id); await gate.resume; executingRefundGate = undefined;
      }
      if (loseRefundResponse) { loseRefundResponse = false; throw new Error('Lost refund response'); }
      return structuredClone(refund);
    },
    retrieveRefund: async (id, options) => { check(); assert.equal(options.stripeAccount, charges.get(refunds.get(id).charge).account); return structuredClone(refunds.get(id)); },
    retrieveCharge: async (id, options) => { check(); assert.equal(options.stripeAccount, charges.get(id).account); return structuredClone(charges.get(id)); },
    retrieveApplicationFee: async id => { check(); return structuredClone(fees.get(id)); },
  };
  function pay(id) {
    const s = sessions.get(id), suffix = id.replace(/[^A-Za-z0-9]/g, '');
    const intentId = `pi_${suffix}`, chargeId = `ch_${suffix}`, feeId = `fee_${suffix}`;
    const charge = { id: chargeId, account: s.account, livemode: false, payment_intent: intentId, amount: s.amount_total, currency: s.currency,
      paid: true, captured: true, refunded: false, amount_refunded: 0, application_fee_amount: s.fee, application_fee: feeId };
    charges.set(chargeId, charge); fees.set(feeId, { id: feeId, livemode: false, currency: s.currency, amount: s.fee, amount_refunded: 0, refunded: false, account: s.account, charge: chargeId });
    s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = { id: intentId, livemode: false, status: 'succeeded', amount: s.amount_total,
      amount_received: s.amount_total, currency: s.currency, metadata: s.metadata, application_fee_amount: s.fee, latest_charge: charge };
  }
  function pauseNextRefundResponse({ idempotencyInUse = false } = {}) {
    assert.equal(refundResponseGate, undefined);
    let executed, release;
    const gate = { executed: new Promise(resolve => { executed = resolve; }), release: () => release() };
    refundResponseGate = { executed, resume: new Promise(resolve => { release = resolve; }), idempotencyInUse };
    return gate;
  }
  return { stripe, sessions, refunds, charges, fees, thinEvents, pay, pauseNextRefundResponse, unavailable: value => { unavailable = value; }, loseNextRefund: () => { loseRefundResponse = true; }, loseNextCreation: () => { loseCreationResponse = true; }, creations: () => creations, refundCreations: () => refundCreations, refundRequests: () => refundRequests };
}

async function checkDisabledMerchant() {
  assertManagedTestDatabase();const config=require('../src/config').getConfig(),sequelize=createSequelize(config),models=initModels(sequelize);
  try {
    const owner=await models.User.create({displayName:'Pause owner',email:`${randomUUID()}@offline.nitewide.test`});
    const buyer=await models.User.create({displayName:'Pause buyer',email:`${randomUUID()}@offline.nitewide.test`});
    const organization=await models.Organization.create({name:'Paused merchant',slug:`pause-${randomUUID()}`,onboardingEstablished:true});
    await models.OrganizationOwner.create({organizationId:organization.id,userId:owner.id,role:'owner'});
    const account=await models.PaymentAccount.create({organizationId:organization.id,name:'Pause fixture',stripeAccountId:`acct_${randomUUID().replaceAll('-','')}`});
    await organization.update({defaultPaymentAccountId:account.id});
    const event=await models.Event.create({creatorUserId:owner.id,organizationId:organization.id,title:'Paused sales',slug:`paused-${randomUUID()}`,
      status:'published',startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+172800000)});
    const paid=await models.Offering.create({eventId:event.id,name:'Paid ticket',priceCents:2000,quantityTotal:10});
    const free=await models.Offering.create({eventId:event.id,name:'Free RSVP',priceCents:0,quantityTotal:10});
    const provider=mockProvider('paused_'),stripe=provider.stripe;
    const accounts=createBusinessPaymentAccountService({models,stripe});
    const controls=createBusinessPaymentDisconnectService({models,stripe,paymentAccounts:accounts});
    const checkout=createCheckoutService({sequelize,models,environment:'test',email:null});
    const payments=createStripeCheckoutService({sequelize,models,stripe,checkout,email:null});
    const input={buyerUserId:buyer.id,eventId:event.id,idempotencyKey:randomUUID(),items:[{offeringId:paid.id,quantity:1}]};
    const started=await payments.prepare(input);
    await controls.disable(owner.id,organization.id,account.id,{confirmed:true,reason:'Pause new sales',idempotencyKey:randomUUID()});
    await assert.rejects(payments.prepare({...input,idempotencyKey:randomUUID()}),{code:'PAYMENTS_NOT_READY'});
    const retry=await payments.prepare(input);assert.equal(retry.orderId,started.orderId);assert.equal(retry.clientSecret,started.clientSecret);
    const rsvp=await payments.prepare({...input,idempotencyKey:randomUUID(),items:[{offeringId:free.id,quantity:1}]});
    assert.equal(rsvp.status,'paid');assert.equal(await models.Ticket.count({where:{eventId:event.id}}),1);
    const order=await models.Order.findByPk(started.orderId);provider.pay(order.checkoutSessionId);
    assert.equal((await payments.verify(buyer.id,order.id)).status,'paid');
    assert.equal(await models.Ticket.count({where:{eventId:event.id,status:'valid'}}),2);
    assert.equal(provider.creations(),1,'free bookings and failed new checkout create no extra paid session');
  } finally {await sequelize.close();}
}

test('sandbox provider reservations, verified webhook races and full refunds use durable server identity', { timeout: 60000 }, async (t) => {
  assertManagedTestDatabase();
  const sequelize = createSequelize(require('../src/config').getConfig()), models = initModels(sequelize);
  const provider = mockProvider(), buyer = randomUUID(), other = randomUUID(), owner = randomUUID();
  const queuedEmails = []; let failEmail = false;
  const email = { enabled: true, queue: async (message, transaction) => {
    const job = await models.EmailOutbox.create({ templateAlias: message.template, dedupeKey: message.key, recipientEmail: message.to, encryptedVariables: 'offline fixture' }, { transaction });
    if (failEmail) throw new Error('Simulated durable receipt queue failure');
    queuedEmails.push(message.key); return job;
  } };
  try {
    await models.User.bulkCreate([buyer, other, owner].map(id => ({ id, displayName: 'Stripe fixture', email: `${id}@offline.nitewide.test` })));
    const organization = await models.Organization.create({ name: 'Stripe fixture', slug: `stripe-${randomUUID()}` });
    await models.OrganizationOwner.create({ organizationId: organization.id, userId: owner, role: 'owner' });
    const account = await models.PaymentAccount.create({ organizationId: organization.id, name: 'Sandbox business', stripeAccountId: 'acct_fixture', mode: 'test' });
    await organization.update({ defaultPaymentAccountId: account.id });
    const event = await models.Event.create({ creatorUserId: owner, organizationId: organization.id, title: 'Stripe fixture', slug: `stripe-${randomUUID()}`, status: 'published', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) });
    const offering = await models.Offering.create({ eventId: event.id, name: 'Ticket', priceCents: 2000, quantityTotal: 3 });
    const affiliate = await models.EventAffiliate.create({ eventId: event.id, userId: other, code: `legacy-${randomUUID()}`, commissionBps: 2500, status: 'active', accessScope: 'event' });
    const checkout = createCheckoutService({ sequelize, models, email: null, environment: 'test' });
    const payments = createStripeCheckoutService({ sequelize, models, stripe: provider.stripe, checkout, email });
    const refunds = createStripeRefundService({ sequelize, models, stripe: provider.stripe, permissions: createPermissionService(models) });
    const webhook = createStripeWebhookService({ sequelize, models, stripe: provider.stripe, paymentCheckouts: payments, refunds });
    const input = { buyerUserId: buyer, eventId: event.id, affiliateCode: affiliate.code, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 2 }] };
    let prepared, order;
    await t.test('reserve without admissions; concurrent retries restore same provider session and stop oversell', async () => {
      const results = await Promise.all([payments.prepare(input), payments.prepare(input)]);
      prepared = results[0]; assert.equal(prepared.status, 'pending'); assert.equal(prepared.stripeAccountId, account.stripeAccountId);
      assert.equal(results[1].orderId, prepared.orderId); assert.equal(results[1].clientSecret, prepared.clientSecret); assert.equal(provider.creations(), 1);
      order = await models.Order.findByPk(prepared.orderId);
      assert.equal(order.affiliateCommissionCents, 0, 'merchant onboarding does not unlock an individual commission recipient');
      assert.equal(order.pricingPlanSnapshot.commissionBps, 0);
      assert.equal(order.pricingPlanSnapshot.configuredCommissionBps, 2500);
      assert.equal(order.pricingPlanSnapshot.commissionEligibility.eligible, false);
      assert.equal((await affiliate.reload()).commissionBps, 2500, 'legacy configured terms remain intact');
      assert.equal(await models.Order.count(), 1); assert.equal(await models.OrderItem.count(), 1); assert.equal(await models.Ticket.count(), 0);
      assert.equal(await models.Payment.count(), 0); assert.equal(await models.EmailOutbox.count(), 0); assert.equal(await models.NotificationJob.count(), 0);
      assert.equal((await offering.reload()).quantityReserved, 2); assert.equal(offering.quantitySold, 0);
      await assert.rejects(payments.prepare({ ...input, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 2 }] }), { code: 'INSUFFICIENT_INVENTORY' });
      await assert.rejects(checkout({ ...input, idempotencyKey: randomUUID(), payment: { provider: 'demo', status: 'succeeded' } }), { code: 'INSUFFICIENT_INVENTORY' });
      await assert.rejects(payments.lookup(other, input.idempotencyKey), { status: 404 });
      await assert.rejects(payments.verify(other, order.id), { status: 404 });
    });
    await t.test('abandoned checkout resumes by buyer-owned order with original prices and merchant, not another reservation', async () => {
      await assert.rejects(payments.resume(other, order.id), { status: 404 });
      const originalPrice = offering.priceCents;
      await offering.update({ priceCents: originalPrice + 1000 });
      const recovered = await payments.resume(buyer, order.id);
      assert.equal(recovered.orderId, prepared.orderId);
      assert.equal(recovered.clientSecret, prepared.clientSecret);
      assert.equal(recovered.stripeAccountId, account.stripeAccountId);
      assert.equal(recovered.booking.idempotencyKey, input.idempotencyKey);
      assert.equal(recovered.booking.totalCents, order.totalCents);
      assert.equal(recovered.booking.items[0].unitPriceCents, originalPrice);
      assert.equal(recovered.booking.items[0].quantity, 2);
      require('../src/http/payment-schemas').checkoutResumption.parse(JSON.parse(JSON.stringify(recovered)));
      const customer = require('../src/services/customer-account-service').createCustomerAccountService({ models, tokenSecret: 'offline-test' });
      const booked = await customer.bookings(buyer);
      assert.equal(booked.orders.some(value => value.id === order.id), false, 'unpaid attempts are not bookings');
      assert.equal(booked.total, 0, 'unfinished checkout is excluded from pagination counts');
      const notifications = require('../src/services/notification-service').createNotificationService(models);
      const notices = await notifications.page(buyer, { pageSize: 1 });
      assert.equal(notices.total, 1); assert.equal(notices.unreadCount, 1);
      assert.equal(notices.items[0].kind, 'checkout_pending');
      assert.equal(notices.items[0].message, `Continue your purchase for ${event.title}?`);
      assert.deepEqual(notices.items[0].metadata, { orderId: order.id });
      assert.equal((await notifications.page(other)).total, 0);
      assert.equal(await models.Notification.count({ where: { kind: 'checkout_pending', id: order.id } }), 1, 'retries create exactly one durable reminder');
      await notifications.markRead(buyer, order.id);
      assert.equal((await notifications.page(buyer)).total, 1, 'opening leaves the reminder available for another abandonment');
      assert.equal(await notifications.unreadCount(buyer), 0);
      await assert.rejects(notifications.dismiss(other, order.id), { status: 404 });
      assert.equal((await customer.purchaseTickets(buyer, order.id)).canResumePayment, true);
      assert.equal(provider.creations(), 1);
      assert.equal(await models.Order.count(), 1);
      assert.equal((await offering.reload()).quantityReserved, 2);
      await offering.update({ priceCents: originalPrice });
    });
    await t.test('unknown provider outcome retains reservations; local expiry alone cannot release inventory', async () => {
      provider.unavailable(true);
      assert.equal((await payments.verify(buyer, order.id)).retryable, true);
      await order.update({ reservationExpiresAt: new Date(Date.now() - 1000) });
      assert.equal((await payments.sweepReservations())[0].retryable, true);
      assert.equal((await offering.reload()).quantityReserved, 2);
      provider.unavailable(false);
    });
    await t.test('webhook and browser reconciliation race issues exactly once; duplicate signed events are replay safe', async () => {
      provider.pay(order.checkoutSessionId);
      failEmail = true;
      assert.equal((await payments.verify(buyer, order.id)).retryable, true);
      assert.equal(await models.Payment.count(), 0); assert.equal(await models.Ticket.count(), 0); assert.equal(await models.EmailOutbox.count(), 0);
      assert.equal((await offering.reload()).quantityReserved, 2); assert.equal(offering.quantitySold, 0);
      failEmail = false;
      const eventBody = Buffer.from(JSON.stringify({ id: 'evt_complete', type: 'checkout.session.completed', livemode: false, account: account.stripeAccountId, data: { object: { id: order.checkoutSessionId, payment_status: 'unpaid' } } }));
      await assert.rejects(webhook.receive(eventBody, 'forged'), { code: 'INVALID_WEBHOOK' });
      const results = await Promise.all([payments.verify(buyer, order.id), webhook.receive(eventBody, 'verified-signature')]);
      assert.equal(results[0].status, 'paid');
      assert.equal((await webhook.receive(eventBody, 'verified-signature')).replayed, true);
      assert.equal(await models.Payment.count(), 1); assert.equal(await models.Ticket.count(), 2); assert.equal(await models.AffiliateAttribution.count(), 1);
      assert.equal(await models.EmailOutbox.count(), 1); assert.equal(await models.NotificationJob.count(), 1); assert.equal(queuedEmails.length, 1);
      assert.equal((await offering.reload()).quantityReserved, 0); assert.equal(offering.quantitySold, 2);
      assert.equal((await payments.lookup(buyer, input.idempotencyKey)).status, 'paid');
    });
    await t.test('only merchant finance can request full refund; verified fee return voids tickets once', async () => {
      const replacement = await models.PaymentAccount.create({ organizationId: organization.id, name: 'Replacement sandbox business',
        stripeAccountId: 'acct_replacement', mode: 'test', accountApiVersion: 'v2', lifecycleState: 'active',
        detailsSubmitted: true, chargesEnabled: true, cardPaymentsActive: true, controllerMatches: true, synchronizedAt: new Date() });
      const merchantSelection = createBusinessPaymentAccountService({ models, stripe: provider.stripe });
      await merchantSelection.selectEvent(owner, event.id, replacement.id);
      assert.equal((await event.reload()).paymentAccountId, replacement.id);
      assert.equal((await order.reload()).paymentAccountId, account.id, 'settled order keeps its original merchant despite event routing changes');
      const refundInput = { reason: 'Merchant approves customer cancellation', idempotencyKey: randomUUID() };
      await assert.rejects(refunds.requestRefund(buyer, order.id, refundInput), { code: 'FORBIDDEN' });
      provider.loseNextRefund();
      const uncertain = await refunds.requestRefund(owner, order.id, refundInput);
      assert.equal(uncertain.status, 'pending'); assert.equal(uncertain.retryable, true);
      assert.equal((await models.Refund.findByPk(uncertain.refundId)).providerReference, null);
      assert.equal((await order.reload()).status, 'paid'); assert.equal(await models.Ticket.count({ where: { status: 'void' } }), 0);
      provider.unavailable(true);
      const waiting = await refunds.sweepPendingRefunds();
      assert.equal(waiting[0].retryable, true); assert.equal((await order.reload()).status, 'paid');
      provider.unavailable(false);
      const [result] = await refunds.sweepPendingRefunds();
      assert.deepEqual(await refunds.sweepPendingRefunds(), []);
      assert.equal(result.status, 'succeeded');
      assert.equal((await refunds.requestRefund(owner, order.id, refundInput)).refundId, result.refundId);
      assert.equal(provider.refundCreations(), 1); assert.equal(await models.Refund.count(), 1);
      assert.equal((await order.reload()).status, 'refunded'); assert.equal(await models.Ticket.count({ where: { status: 'void' } }), 2);
      assert.equal((await models.Payment.findOne()).status, 'refunded'); assert.equal((await offering.reload()).quantitySold, 2);
      assert.equal((await models.Refund.findByPk(result.refundId)).stripeAccountId, account.stripeAccountId, 'refund is still sent to the order’s original Stripe account');
      await merchantSelection.selectEvent(owner, event.id, null);
      await event.reload();
    });
    await t.test('provider-confirmed expiry releases reservation without issuing admission', async () => {
      const newInput = { ...input, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 1 }] };
      provider.loseNextCreation();
      const attempt = await payments.prepare(newInput);
      assert.equal(attempt.retryable, true);
      const lost = await models.Order.findByPk(attempt.orderId); assert.equal(lost.checkoutSessionId, null);
      const creationsBeforeRecovery = provider.creations();
      assert.equal((await payments.lookup(buyer, newInput.idempotencyKey)).status, 'pending');
      assert.equal(provider.creations(), creationsBeforeRecovery);
      assert.equal((await payments.cancel(buyer, attempt.orderId)).status, 'cancelled');
      assert.equal((await offering.reload()).quantityReserved, 0); assert.equal(await models.Ticket.count(), 2);
      const customer = require('../src/services/customer-account-service').createCustomerAccountService({ models, tokenSecret: 'offline-test' });
      const booked = await customer.bookings(buyer);
      assert.equal(booked.orders.some(value => value.id === attempt.orderId), false, 'unpaid cancelled checkout is not a booking');
      assert.equal(booked.entries.some(value => value.id === attempt.orderId), false);
      assert.equal(booked.total, 1, 'the unpaid cancellation is excluded before pagination/counting');
      assert.equal(booked.orders[0].status, 'refunded', 'real paid/refunded booking history remains visible');
      assert.equal((await models.Order.findByPk(attempt.orderId)).status, 'cancelled', 'the audit record is retained');
      const notifications = require('../src/services/notification-service').createNotificationService(models);
      const notices = await notifications.page(buyer);
      assert.equal(notices.items.some(value => value.kind === 'checkout_pending'), false, 'completed and cancelled attempts have no stale reminder');
      assert.equal((await notifications.list(buyer)).some(value => value.kind === 'checkout_pending'), false);
      assert.equal(await models.Notification.count({ where: { kind: 'checkout_pending', id: attempt.orderId } }), 1, 'the reminder audit record is retained too');
      const resumed = await payments.resume(buyer, attempt.orderId);
      assert.equal(resumed.status, 'cancelled'); assert.equal(resumed.clientSecret, undefined);
      assert.equal(provider.creations(), creationsBeforeRecovery, 'cancelled checkout cannot create a replacement session');
    });
    await t.test('paid evidence arriving after event closure goes to audited review without usable tickets', async () => {
      const attempt = await payments.prepare({ ...input, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 1 }] });
      const pending = await models.Order.findByPk(attempt.orderId);
      provider.pay(pending.checkoutSessionId); await event.update({ lifecycleState: 'archived' });
      const result = await payments.verify(buyer, pending.id);
      assert.equal(result.verificationStatus, 'review'); assert.equal(result.status, 'pending');
      assert.equal(await models.Ticket.count(), 2); assert.equal(await models.Payment.count(), 2);
      assert.equal(await models.AuditLog.count({ where: { action: 'payment.closed_event_review' } }), 1);
      const resumed = await payments.resume(buyer, pending.id);
      assert.equal(resumed.verificationStatus, 'review'); assert.equal(resumed.clientSecret, undefined);
    });
    await t.test('Dashboard partial and fee-incomplete refunds hold admissions; full verified external return settles without invented approval', async () => {
      const externalEvent = await models.Event.create({ creatorUserId: owner, organizationId: organization.id, title: 'Dashboard refund', slug: randomUUID(), status: 'published', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 172800000) });
      const externalOffering = await models.Offering.create({ eventId: externalEvent.id, name: 'Ticket', priceCents: 2000, quantityTotal: 2 });
      const attempt = await payments.prepare({ ...input, affiliateCode: undefined, eventId: externalEvent.id, idempotencyKey: randomUUID(), items: [{ offeringId: externalOffering.id, quantity: 1 }] });
      let externalOrder = await models.Order.findByPk(attempt.orderId);
      provider.pay(externalOrder.checkoutSessionId); await payments.verify(buyer, externalOrder.id); await externalOrder.reload();
      const charge = provider.charges.get(externalOrder.stripeChargeId), fee = provider.fees.get(charge.application_fee);
      const refund = { id: 're_dashboard', status: 'succeeded', amount: 100, currency: charge.currency, payment_intent: charge.payment_intent, charge: charge.id, metadata: {} };
      provider.refunds.set(refund.id, refund); charge.amount_refunded = 100;
      const raw = id => Buffer.from(JSON.stringify({ id, type: 'refund.updated', livemode: false, account: account.stripeAccountId, data: { object: { id: refund.id, status: 'succeeded' } } }));
      const originalIntent = charge.payment_intent; charge.payment_intent = 'pi_unbound';
      await assert.rejects(webhook.receive(raw('evt_bad_external'), 'verified-signature'), { code: 'REFUND_VERIFICATION_FAILED' });
      charge.payment_intent = originalIntent;
      const item = await models.OrderItem.findOne({ where: { orderId: externalOrder.id } });
      assert.equal((await models.Ticket.findOne({ where: { orderItemId: item.id } })).status, 'valid');
      assert.equal((await webhook.receive(raw('evt_partial_external'), 'verified-signature')).received, true);
      assert.equal((await externalOrder.reload()).status, 'paid'); assert.equal(externalOrder.providerVerificationStatus, 'review');
      assert.equal((await models.Ticket.findOne({ where: { orderItemId: item.id } })).status, 'valid');
      charge.refunded = true; charge.amount_refunded = externalOrder.totalCents; refund.amount = externalOrder.totalCents;
      await webhook.receive(raw('evt_external_fee_missing'), 'verified-signature');
      assert.equal((await externalOrder.reload()).status, 'paid');
      fee.refunded = true; fee.amount_refunded = fee.amount;
      const chargedRaw = Buffer.from(JSON.stringify({ id: 'evt_external_charge_full', type: 'charge.refunded', livemode: false, account: account.stripeAccountId, data: { object: { id: charge.id } } }));
      await Promise.all([webhook.receive(chargedRaw, 'verified-signature'), webhook.receive(raw('evt_external_full'), 'verified-signature')]);
      assert.equal((await externalOrder.reload()).status, 'refunded');
      assert.equal(await models.Refund.count({ where: { orderId: externalOrder.id } }), 0);
      const audits = await models.AuditLog.findAll({ where: { entityId: externalOrder.id, action: 'order.external_refund_verified' } });
      assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, null); assert.equal(audits[0].after.approval, 'not_recorded_by_nitewide');
      assert.equal((await externalOffering.reload()).quantitySold, 1);
    });
    await t.test('signed account deauthorization invalidates readiness without retrieving inaccessible account', async () => {
      provider.stripe.retrieveAccount = async () => { throw new Error('Deauthorized account cannot be retrieved'); };
      const raw = Buffer.from(JSON.stringify({ id: 'evt_deauthorized', type: 'account.application.deauthorized', livemode: false, account: account.stripeAccountId, data: { object: { id: 'application' } } }));
      const results = await Promise.all([webhook.receive(raw, 'verified-signature'), webhook.receive(raw, 'verified-signature')]);
      assert.equal(results[0].received, true); assert.equal(results[1].received, true);
      await account.reload(); assert.equal(account.chargesEnabled, false); assert.equal(account.cardPaymentsActive, false);
      assert.equal(account.lifecycleState, 'archived');
      assert.equal(await models.AuditLog.count({ where: { action: 'payment_account.deauthorized' } }), 1);
      assert.equal((await webhook.receive(raw, 'verified-signature')).replayed, true);
      const stale = Buffer.from(JSON.stringify({ id: 'evt_stale_update', type: 'account.updated', livemode: false, account: account.stripeAccountId, data: { object: { charges_enabled: true } } }));
      assert.equal((await webhook.receive(stale, 'verified-signature')).received, true);
      assert.equal((await account.reload()).lifecycleState, 'archived');
    });
    await t.test('v2 thin closure uses independently retrieved related account and cannot restore archived readiness', async () => {
      const second = await models.PaymentAccount.create({ organizationId: organization.id, name: 'Second sandbox business', stripeAccountId: 'acct_closed', mode: 'test', chargesEnabled: true, cardPaymentsActive: true });
      provider.thinEvents.set('evt_v2_closed', { id: 'evt_v2_closed', object: 'v2.core.event', type: 'v2.core.account.closed', livemode: false, related_object: { id: second.stripeAccountId, type: 'v2.core.account' } });
      const raw = Buffer.from(JSON.stringify({ id: 'evt_v2_closed', related_object: { id: 'acct_caller_fake' } }));
      assert.equal((await webhook.receiveAccountNotification(raw, 'verified-thin-signature')).received, true);
      await second.reload(); assert.equal(second.lifecycleState, 'archived'); assert.equal(second.chargesEnabled, false);
      assert.equal((await webhook.receiveAccountNotification(raw, 'verified-thin-signature')).replayed, true);
      assert.equal(await models.AuditLog.count({ where: { action: 'payment_account.deauthorized', entityId: second.id } }), 1);
    });
  } finally { await sequelize.close(); }
});

// The original suite checks whole-database counts against its empty fixture.
// This additional scenario runs afterward and scopes assertions to its event;
// its provider IDs also have a separate namespace to mirror Stripe uniqueness.
test('charge-first refund delivery and historical pending approval recovery settle once without altering admission history', { timeout: 60000 }, async t => {
  assertManagedTestDatabase();
  const sequelize = createSequelize(require('../src/config').getConfig()), models = initModels(sequelize);
  const provider = mockProvider(`refund_race_${randomUUID()}_`);
  const ledger = require('../src/services/commission-ledger-service').createCommissionLedgerService({ sequelize, models });
  try {
    const [owner, buyer, recipient] = await models.User.bulkCreate(['Owner', 'Buyer', 'Recipient'].map(displayName => ({ displayName, email: `${randomUUID()}@offline.nitewide.test` })), { returning: true });
    const organization = await models.Organization.create({ name: 'Refund race fixture', slug: randomUUID() });
    await models.OrganizationOwner.create({ organizationId: organization.id, userId: owner.id, role: 'owner' });
    const account = await models.PaymentAccount.create({ organizationId: organization.id, name: 'Race merchant', stripeAccountId: `acct_race${randomUUID().replaceAll('-', '')}`, mode: 'test' });
    await organization.update({ defaultPaymentAccountId: account.id });
    const event = await models.Event.create({ organizationId: organization.id, creatorUserId: owner.id, title: 'Refund delivery race', slug: randomUUID(), status: 'published',
      startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000) });
    const offering = await models.Offering.create({ eventId: event.id, name: 'Race admission', priceCents: 2000, quantityTotal: 3 });
    const recipientAccountId = `acct_recipient${randomUUID().replaceAll('-', '')}`;
    await models.IndividualCommissionProfile.create({ userId: recipient.id, name: 'Race recipient', creationRequestId: randomUUID(), stripeAccountId: recipientAccountId,
      verifiedAt: new Date(), verifiedStripeAccount: { ...await provider.stripe.retrieveAccount(recipientAccountId), identity: { entity_type: 'individual' } } });
    const affiliate = await models.EventAffiliate.create({ eventId: event.id, userId: recipient.id, code: randomUUID(), commissionBps: 2500, status: 'active', accessScope: 'event' });
    const checkout = createCheckoutService({ sequelize, models, email: null, environment: 'test' });
    const payments = createStripeCheckoutService({ sequelize, models, stripe: provider.stripe, checkout, email: null });
    const refunds = createStripeRefundService({ sequelize, models, stripe: provider.stripe, permissions: createPermissionService(models) });
    const webhook = createStripeWebhookService({ sequelize, models, stripe: provider.stripe, paymentCheckouts: payments, refunds });
    const checkIn = require('../src/services/checkin-service').createCheckInService({ sequelize, models, environment: 'test' });
    const raw = (type, id, reference) => Buffer.from(JSON.stringify({ id, type, livemode: false, account: account.stripeAccountId, data: { object: { id: reference } } }));
    async function paidAdmission() {
      const prepared = await payments.prepare({ buyerUserId: buyer.id, eventId: event.id, affiliateCode: affiliate.code, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 1 }] });
      const order = await models.Order.findByPk(prepared.orderId);
      provider.pay(order.checkoutSessionId); await payments.verify(buyer.id, order.id); await order.reload();
      assert.equal(order.affiliateCommissionCents, 500);
      const item = await models.OrderItem.findOne({ where: { orderId: order.id } });
      const ticket = await models.Ticket.findOne({ where: { orderItemId: item.id } });
      await checkIn({ eventId: event.id, credentialId: ticket.id, kind: 'ticket', checkedInByUserId: owner.id });
      await ledger.setRefundHold({ orderId: order.id, hold: true });
      return { order, ticket };
    }
    async function settlementState(order, ticket) {
      await order.reload(); await ticket.reload(); await offering.reload();
      const earning = await models.CommissionEarning.findOne({ where: { orderId: order.id } });
      const admitted = await models.CheckIn.findOne({ where: { ticketId: ticket.id } });
      return { orderStatus: order.status, refundedTotalCents: order.refundedTotalCents, refundedSubtotalCents: order.refundedSubtotalCents,
        refundedCommissionCents: order.refundedCommissionCents, reservationReleasedAt: +order.reservationReleasedAt,
        reserved: offering.quantityReserved, sold: offering.quantitySold, ticketStatus: ticket.status, ticketCheckedInAt: +ticket.checkedInAt,
        checkInId: admitted.id, checkInAt: +admitted.checkedInAt, checkInCount: await models.CheckIn.count({ where: { ticketId: ticket.id } }),
        paymentStatus: (await models.Payment.findOne({ where: { orderId: order.id, provider: 'stripe' } })).status,
        unpaidCommissionCents: earning.unpaidCommissionCents, refundedEarningCents: earning.refundedCommissionCents, businessLossCents: earning.businessLossCents,
        refundHold: earning.refundHold, adjustmentAudits: await models.AuditLog.count({ where: { entityId: order.id, action: 'commission.refund_adjusted' } }) };
    }
    async function assertReplaySafe(order, ticket, result, prefix, expectedExternalAudits) {
      const refund = await models.Refund.findByPk(result.refundId);
      assert.equal(refund.status, 'succeeded'); assert.equal(refund.approvedByUserId, owner.id);
      assert.equal(refund.adminOverride, false); assert.equal(refund.providerReference, result.reference);
      const settled = await settlementState(order, ticket);
      assert.equal(settled.orderStatus, 'refunded'); assert.equal(settled.refundedTotalCents, order.totalCents); assert.equal(settled.refundedSubtotalCents, order.subtotalCents);
      assert.equal(settled.ticketStatus, 'void'); assert.equal(settled.checkInCount, 1); assert.ok(settled.ticketCheckedInAt);
      assert.equal(settled.paymentStatus, 'refunded'); assert.equal(settled.reserved, 0);
      assert.equal(settled.refundedCommissionCents, 500); assert.equal(settled.refundedEarningCents, 500);
      assert.equal(settled.unpaidCommissionCents, 0); assert.equal(settled.businessLossCents, 0); assert.equal(settled.refundHold, false);
      assert.equal(settled.adjustmentAudits, 1);
      const created = raw('refund.created', `evt_${prefix}_created`, refund.providerReference);
      const updated = raw('refund.updated', `evt_${prefix}_updated`, refund.providerReference);
      const charged = raw('charge.refunded', `evt_${prefix}_charged_again`, order.stripeChargeId);
      for (const body of [created, updated, charged]) {
        assert.equal((await webhook.receive(body, 'verified-signature')).received, true);
        assert.equal((await webhook.receive(body, 'verified-signature')).replayed, true);
      }
      assert.deepEqual(await refunds.sweepPendingRefunds(), []);
      assert.deepEqual(await settlementState(order, ticket), settled, 'webhook redelivery and worker sweep cannot repeat inventory or commission adjustments or erase admission history');
      assert.equal(await models.AuditLog.count({ where: { entityId: refund.id, action: 'refund.merchant_approved' } }), 1);
      const audit = await models.AuditLog.findAll({ where: { entityId: order.id, action: 'order.refunded' } });
      assert.equal(audit.length, 1); assert.equal(audit[0].actorUserId, owner.id); assert.equal(audit[0].after.refundId, refund.id);
      assert.equal(audit[0].after.recoveredPreviouslyRefunded, Boolean(expectedExternalAudits));
      assert.equal(await models.AuditLog.count({ where: { entityId: order.id, action: 'order.external_refund_verified' } }), expectedExternalAudits);
    }
    for (const idempotencyInUse of [false, true]) await t.test(idempotencyInUse
      ? 'charge-first delivery stays retryable when the original refund key is in use, then acknowledges the retry without external fallback'
      : 'charge.refunded without embedded refunds finishes an approved refund before its creation response returns', async () => {
      const { order, ticket } = await paidAdmission();
      const creations = provider.refundCreations(), prefix = idempotencyInUse ? 'refund_race_busy' : 'refund_race';
      const gate = provider.pauseNextRefundResponse({ idempotencyInUse });
      const input = { reason: 'Merchant approves the race fixture refund', idempotencyKey: randomUUID() };
      const pending = refunds.requestRefund(owner.id, order.id, input);
      const charged = raw('charge.refunded', `evt_${prefix}_charge_first`, order.stripeChargeId);
      let result, reference;
      try {
        reference = await gate.executed;
        assert.equal('refunds' in provider.charges.get(order.stripeChargeId), false, 'modern Charge retrieval need not embed a refund list');
        assert.equal((await models.Refund.findOne({ where: { orderId: order.id } })).providerReference, null);
        if (idempotencyInUse) {
          await assert.rejects(webhook.receive(charged, 'verified-signature'), { code: 'STRIPE_RECONCILIATION_PENDING', status: 503 });
          assert.equal((await models.StripeWebhookReceipt.findOne({ where: { stripeEventId: `evt_${prefix}_charge_first` } })).status, 'pending');
          assert.equal((await order.reload()).status, 'paid'); assert.equal((await ticket.reload()).status, 'checked_in');
          assert.equal(await models.AuditLog.count({ where: { entityId: order.id, action: 'order.external_refund_verified' } }), 0);
          assert.equal(await models.AuditLog.count({ where: { entityId: order.id, action: 'commission.refund_adjusted' } }), 0);
        } else assert.equal((await webhook.receive(charged, 'verified-signature')).received, true);
      } finally { gate.release(); result = await pending; }
      assert.equal(result.status, 'succeeded', 'the initiating business action must succeed when a verified webhook won the race');
      assert.equal((await webhook.receive(charged, 'verified-signature')).received, true);
      assert.equal((await webhook.receive(charged, 'verified-signature')).replayed, true);
      assert.equal((await models.StripeWebhookReceipt.findOne({ where: { stripeEventId: `evt_${prefix}_charge_first` } })).status, 'processed');
      assert.equal(provider.refundCreations(), creations + 1);
      await assertReplaySafe(order, ticket, { ...result, reference }, prefix, 0);
      assert.equal((await refunds.requestRefund(owner.id, order.id, input)).refundId, result.refundId);
      assert.equal(provider.refundCreations(), creations + 1);
    });
    await t.test('worker repairs an already-refunded order with a bound pending approval without refunding or adjusting money again', async () => {
      const { order, ticket } = await paidAdmission();
      const input = { reason: 'Recover the historical charge-first state', idempotencyKey: randomUUID() };
      provider.loseNextRefund();
      const pending = await refunds.requestRefund(owner.id, order.id, input);
      assert.equal(pending.status, 'pending'); assert.equal(pending.retryable, true);
      const refund = await models.Refund.findByPk(pending.refundId);
      const reference = [...provider.refunds.values()].find(value => value.metadata.refundId === refund.id).id;
      const evidence = provider.refunds.get(reference), unadjusted = await settlementState(order, ticket);
      const otherCharge = [...provider.charges.values()].find(value => value.id !== order.stripeChargeId);
      for (const [field, value] of [['charge', otherCharge.id], ['payment_intent', otherCharge.payment_intent], ['amount', evidence.amount - 1], ['currency', 'eur']]) {
        const id = `re_lookalike${randomUUID().replaceAll('-', '')}`, eventId = `evt_wrong_refund_${field}`;
        provider.refunds.set(id, { ...evidence, id, [field]: value });
        await assert.rejects(webhook.receive(raw('refund.created', eventId, id), 'verified-signature'), { code: 'REFUND_VERIFICATION_FAILED' });
        assert.equal((await refund.reload()).providerReference, null, `${field} mismatch cannot bind a refund ID based only on copied metadata`);
        assert.equal((await models.StripeWebhookReceipt.findOne({ where: { stripeEventId: eventId } })).status, 'pending');
        assert.deepEqual(await settlementState(order, ticket), unadjusted);
      }
      const competingReference = `re_competing${randomUUID().replaceAll('-', '')}`;
      provider.refunds.set(competingReference, { ...evidence, id: competingReference });
      const findRefund = models.Refund.findOne;
      let observedStaleApproval = false;
      models.Refund.findOne = async function (options) {
        const row = await findRefund.call(this, options);
        if (options.where.id === refund.id && !observedStaleApproval) {
          observedStaleApproval = true;
          assert.equal(row.providerReference, null);
          // Deterministically make the metadata lookup stale before the bind
          // transaction acquires its UPDATE lock, as a concurrent winner would.
          await refund.update({ providerReference: reference });
        }
        return row;
      };
      try {
        await assert.rejects(webhook.receive(raw('refund.updated', 'evt_stale_refund_pointer', competingReference), 'verified-signature'), { code: 'REFUND_VERIFICATION_FAILED' });
      } finally { models.Refund.findOne = findRefund; }
      assert.equal(observedStaleApproval, true);
      assert.equal((await refund.reload()).providerReference, reference, 'a stale metadata lookup must not overwrite the winner’s durable provider binding');
      assert.equal((await models.StripeWebhookReceipt.findOne({ where: { stripeEventId: 'evt_stale_refund_pointer' } })).status, 'pending');
      assert.deepEqual(await settlementState(order, ticket), unadjusted);
      await refund.update({ providerReference: reference });
      // Reproduce the pre-fix durable state: external charge reconciliation
      // completed the financial changes but left the recorded approval pending.
      await sequelize.transaction(async transaction => {
        await order.update({ status: 'refunded', providerVerificationStatus: 'verified', reservationReleasedAt: new Date() }, { transaction });
        await ticket.update({ status: 'void' }, { transaction });
        await models.Payment.update({ status: 'refunded' }, { where: { orderId: order.id, provider: 'stripe' }, transaction });
        await ledger.adjustRefund({ order, cumulativeRefundedTotalCents: order.totalCents, refundId: 'evt_historical_charge_first', transaction });
        await ledger.setRefundHold({ orderId: order.id, hold: false, transaction });
        await models.AuditLog.create({ organizationId: organization.id, entityType: 'Order', entityId: order.id, action: 'order.external_refund_verified',
          after: { origin: 'stripe_provider_external', stripeEventId: 'evt_historical_charge_first', customerAmountRefundedCents: order.totalCents, applicationFeeRefunded: true, approval: 'not_recorded_by_nitewide' } }, { transaction });
      });
      const before = await settlementState(order, ticket), creations = provider.refundCreations(), requests = provider.refundRequests();
      const [result] = await refunds.sweepPendingRefunds();
      assert.equal(result.refundId, refund.id); assert.equal(result.status, 'succeeded');
      assert.equal(provider.refundCreations(), creations, 'bound historical recovery retrieves evidence and never sends another create-refund request');
      assert.equal(provider.refundRequests(), requests);
      assert.deepEqual(await settlementState(order, ticket), before, 'historical financial state and check-in history remain unchanged');
      await assertReplaySafe(order, ticket, { ...result, reference }, 'historical_refund_race', 1);
      assert.equal(provider.refundRequests(), requests);
      assert.equal(provider.refundCreations(), 3, 'one provider refund per approved order, including all recovery and replay paths');
    });
  } finally { await sequelize.close(); }
});

test('disabled merchant stops new paid sessions but preserves in-flight checkout and free bookings',{timeout:30000},checkDisabledMerchant);

test('checkout refreshes only server-bound stale personal recipients outside purchase locks and revalidates before snapshot', { timeout: 60000 }, async t => {
  assertManagedTestDatabase();
  const sequelize = createSequelize(require('../src/config').getConfig()), models = initModels(sequelize);
  let current = new Date(), purchaseDepth = 0, refreshCount = 0, failRefresh = false;
  const now = () => current;
  const checkoutSequelize = { query: sequelize.query.bind(sequelize), transaction: (options, work) => sequelize.transaction(options, async transaction => {
    purchaseDepth++; try { return await work(transaction); } finally { purchaseDepth--; }
  }) };
  try {
    const owner = await models.User.create({ displayName: 'Refresh owner', email: `${randomUUID()}@offline.nitewide.test` });
    const person = await models.User.create({ displayName: 'Refresh recipient', email: `${randomUUID()}@offline.nitewide.test` });
    const buyer = await models.User.create({ displayName: 'Refresh buyer', email: `${randomUUID()}@offline.nitewide.test` });
    const organization = await models.Organization.create({ name: 'Refresh business', slug: `refresh-${randomUUID()}` });
    await models.OrganizationOwner.create({ organizationId: organization.id, userId: owner.id, role: 'owner' });
    const merchant = await models.PaymentAccount.create({ organizationId: organization.id, name: 'Refresh merchant', stripeAccountId: `acct_merchant_${randomUUID()}` });
    await organization.update({ defaultPaymentAccountId: merchant.id });
    const event = await models.Event.create({ creatorUserId: owner.id, organizationId: organization.id, title: 'Refresh night', slug: `refresh-${randomUUID()}`,
      status: 'published', startsAt: new Date(+current + 86400000), endsAt: new Date(+current + 172800000) });
    const offering = await models.Offering.create({ eventId: event.id, name: 'Refresh ticket', priceCents: 2000, quantityTotal: 40 });
    const affiliate = await models.OrgAffiliate.create({ organizationId: organization.id, userId: person.id, code: `REFRESH-${randomUUID()}`, defaultCommissionBps: 2500 });
    const accountId = `acct_person_${randomUUID()}`;
    const evidence = { id: accountId, object: 'v2.core.account', livemode: false, dashboard: 'full', identity: { entity_type: 'individual' }, applied_configurations: ['merchant'],
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } };
    const profile = await models.IndividualCommissionProfile.create({ userId: person.id, name: 'Refresh person', creationRequestId: randomUUID(),
      stripeAccountId: accountId, verifiedAt: new Date(+current - 6 * 60000), verifiedStripeAccount: evidence });
    const provider = mockProvider(`refresh_${randomUUID()}_`);
    provider.stripe.retrieveIndividualAccount = async id => {
      assert.equal(purchaseDepth, 0, 'personal provider retrieval must never hold event/inventory transaction locks');
      assert.equal(id, accountId, 'only the server-authorized referral personal binding is retrieved');
      refreshCount++;
      if (failRefresh) throw new Error('Mock personal account retrieval unavailable');
      return structuredClone(evidence);
    };
    const individualProfiles = require('../src/services/individual-commission-profile-service').createIndividualCommissionProfileService({ sequelize, models, stripe: provider.stripe, now });
    const checkout = createCheckoutService({ sequelize, models, environment: 'test', now });
    const payments = createStripeCheckoutService({ sequelize: checkoutSequelize, models, stripe: provider.stripe, checkout, individualProfiles, now });
    const input = () => ({ buyerUserId: buyer.id, eventId: event.id, affiliateCode: affiliate.code, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 1 }],
      individualProfile: { stripeAccountId: 'acct_browser_forged', eligible: true } });
    let firstInput, firstOrder;
    await t.test('stale ready recipient is refreshed before creating attribution and earns configured commission', async () => {
      const synchronize = individualProfiles.synchronizeTrusted;
      individualProfiles.synchronizeTrusted = async id => {
        assert.equal(await models.EventAffiliate.count({ where: { eventId: event.id } }), 0, 'preflight cannot create an assignment');
        return synchronize(id);
      };
      firstInput = input(); const started = await payments.prepare(firstInput);
      individualProfiles.synchronizeTrusted = synchronize;
      firstOrder = await models.Order.findByPk(started.orderId);
      assert.equal(refreshCount, 1); assert.equal(firstOrder.affiliateCommissionCents, 500);
      assert.equal(firstOrder.commissionSnapshot.stripeAccountId, accountId); assert.equal(firstOrder.commissionSnapshot.effectiveCommissionBps, 2500);
    });
    await t.test('fresh cache bypasses retrieval; immutable attempt retries bypass later stale evidence', async () => {
      await payments.prepare(input()); assert.equal(refreshCount, 1);
      current = new Date(+current + 6 * 60000); failRefresh = true;
      const replay = await payments.prepare(firstInput);
      assert.equal(replay.orderId, firstOrder.id); assert.equal(refreshCount, 1);
      await firstOrder.reload(); assert.equal(firstOrder.affiliateCommissionCents, 500);
    });
    await t.test('transport failure for an established recipient returns recoverable error without reserving or freezing zero', async () => {
      const before = await models.Order.count({ where: { eventId: event.id } });
      const reserved = (await offering.reload()).quantityReserved;
      await assert.rejects(payments.prepare(input()), error => error.code === 'COMMISSION_RECIPIENT_VERIFICATION_UNAVAILABLE' && error.status === 503 && error.details.retryable === true);
      assert.equal(await models.Order.count({ where: { eventId: event.id } }), before);
      assert.equal((await offering.reload()).quantityReserved, reserved);
    });
    await t.test('a returned stale observation also cannot silently freeze a zero-rate attempt', async () => {
      const synchronize = individualProfiles.synchronizeTrusted;
      individualProfiles.synchronizeTrusted = async () => profile;
      await assert.rejects(payments.prepare(input()), { code: 'COMMISSION_RECIPIENT_VERIFICATION_UNAVAILABLE' });
      individualProfiles.synchronizeTrusted = synchronize;
    });
    await t.test('locked snapshot revalidation respects a concurrent personal disable', async () => {
      failRefresh = false;
      const synchronize = individualProfiles.synchronizeTrusted;
      individualProfiles.synchronizeTrusted = async id => {
        await synchronize(id);
        await profile.update({ paymentsDisabledAt: current, status: 'inactive' });
      };
      const started = await payments.prepare(input());
      individualProfiles.synchronizeTrusted = synchronize;
      const order = await models.Order.findByPk(started.orderId);
      assert.equal(order.affiliateCommissionCents, 0); assert.equal(order.commissionSnapshot.commissionEligibility.eligible, false);
    });
    await t.test('truly unonboarded connected recipient retains effective zero when refresh fails', async () => {
      await profile.update({ paymentsDisabledAt: null, status: 'inactive', verifiedAt: new Date(+current - 6 * 60000),
        verifiedStripeAccount: { ...evidence, requirements: { entries: [{ id: 'identity_document', awaiting_action_from: 'user' }] } } });
      failRefresh = true;
      const started = await payments.prepare(input()), order = await models.Order.findByPk(started.orderId);
      assert.equal(order.affiliateCommissionCents, 0); assert.equal(order.commissionSnapshot.configuredCommissionBps, 2500);
    });
  } finally { await sequelize.close(); }
});

test('temporary shared sandbox merchant serves all businesses without changing ownership or historical routing',{timeout:60000},async t=>{
  assertManagedTestDatabase();
  const config=require('../src/config').getConfig(),sequelize=createSequelize(config),models=initModels(sequelize);
  const {resolvePaymentAccount}=require('../src/services/business-payment-account-service');
  const {assertPaidPublication}=require('../src/services/payment-readiness-service');
  const request=require('supertest'),{createApp}=require('../src/app');
  try {
    const owner=await models.User.create({displayName:'Shared test owner',email:`${randomUUID()}@offline.nitewide.test`});
    const buyer=await models.User.create({displayName:'Shared test customer',email:`${randomUUID()}@offline.nitewide.test`});
    const businesses=[];
    for(const name of ['Canonical merchant business','Second test business','New test business']) {
      const org=await models.Organization.create({name,slug:randomUUID(),onboardingEstablished:true});
      await models.OrganizationOwner.create({organizationId:org.id,userId:owner.id,role:'owner'});
      businesses.push(org);
    }
    const shared=await models.PaymentAccount.create({organizationId:businesses[0].id,name:'Shared sandbox',stripeAccountId:'acct_sharedintegration'});
    const original=await models.PaymentAccount.create({organizationId:businesses[1].id,name:'Original merchant',stripeAccountId:'acct_originalintegration'});
    await businesses[1].update({defaultPaymentAccountId:original.id});
    const provider=mockProvider('shared_'),stripe=provider.stripe;
    const checkout=createCheckoutService({sequelize,models,environment:'test',email:null});
    const payments=createStripeCheckoutService({sequelize,models,stripe,checkout,email:null});
    const accounts=createBusinessPaymentAccountService({models,stripe});
    const events=[],offerings=[];
    for(const org of businesses) {
      const event=await models.Event.create({organizationId:org.id,creatorUserId:owner.id,title:'Shared sandbox fixture',slug:randomUUID(),status:'published',
        startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+172800000)});
      events.push(event);offerings.push(await models.Offering.create({eventId:event.id,name:'Ticket',priceCents:2000,quantityTotal:10}));
    }
    const oldInput={buyerUserId:buyer.id,eventId:events[1].id,idempotencyKey:randomUUID(),items:[{offeringId:offerings[1].id,quantity:1}]};
    const oldAttempt=await payments.prepare(oldInput),oldOrder=await models.Order.findByPk(oldAttempt.orderId);
    const oldSnapshot=oldOrder.toJSON();
    stripe.sandboxSharedAccountId=shared.stripeAccountId;
    const sharedAccounts=createBusinessPaymentAccountService({models,stripe});
    const app=createApp({sequelize,models,config,services:{stripe,email:{enabled:false}}});
    await t.test('both existing businesses and a business without any profile use the verified shared merchant',async()=>{
      for(let index=0;index<businesses.length;index++) {
        const result=await payments.prepare({buyerUserId:buyer.id,eventId:events[index].id,idempotencyKey:randomUUID(),items:[{offeringId:offerings[index].id,quantity:1}]});
        const order=await models.Order.findByPk(result.orderId);
        assert.equal(order.paymentAccountId,shared.id);assert.equal(order.stripeAccountId,shared.stripeAccountId);
        assert.equal(order.pricingPlanSnapshot.merchant.organizationId,businesses[index].id);
        assert.equal(order.pricingPlanSnapshot.merchant.sharedSandbox,true);
        assert.ok(order.applicationFeeCents>0);assert.equal(provider.sessions.get(order.checkoutSessionId).account,shared.stripeAccountId);
        assert.equal((await businesses[index].reload()).defaultPaymentAccountId,index===1?original.id:null);
        await assertPaidPublication({models,event:events[index],offerings:[offerings[index]],stripe,environment:'test'});
      }
      assert.equal(await models.PaymentAccount.count({where:{stripeAccountId:shared.stripeAccountId}}),1);
      assert.equal((await shared.reload()).organizationId,businesses[0].id);
    });
    await t.test('list shows shared routing without exposing another business profile or granting its management access',async()=>{
      const response=await request(app).get(`/api/business/organizations/${businesses[2].id}/payment-accounts`).set('x-user-id',owner.id).expect(200);
      require('../src/http/payment-schemas').paymentAccountPage.parse(response.body.data);
      assert.deepEqual(response.body.data.sharedSandboxAccount,{stripeAccountId:shared.stripeAccountId,paymentsReady:true});
      assert.deepEqual(response.body.data.items,[]);assert.equal(response.body.data.total,0);
      await request(app).post(`/api/business/organizations/${businesses[2].id}/payment-accounts/${shared.id}/synchronize`).set('x-user-id',owner.id).expect(404);
      await request(app).get(`/api/business/organizations/${businesses[2].id}/payment-accounts`).set('x-user-id',buyer.id).expect(403);
      await assert.rejects(sharedAccounts.selectDefault(owner.id,businesses[1].id,null),{code:'SANDBOX_SHARED_MERCHANT'});
      await assert.rejects(sharedAccounts.selectEvent(owner.id,events[1].id,original.id),{code:'SANDBOX_SHARED_MERCHANT'});
      const controls=createBusinessPaymentDisconnectService({models,stripe,paymentAccounts:sharedAccounts});
      const body={confirmed:true,reason:'Attempt a shared disconnect',idempotencyKey:randomUUID()};
      await assert.rejects(controls.disable(owner.id,businesses[0].id,shared.id,body),{code:'SANDBOX_SHARED_MERCHANT'});
      await assert.rejects(controls.disconnect(owner.id,businesses[0].id,shared.id,body),{code:'SANDBOX_SHARED_MERCHANT'});
      assert.ok((await controls.impact(owner.id,businesses[0].id,shared.id)).blockedReasons.some(reason=>reason.includes('shared sandbox')));
    });
    await t.test('pre-existing retries retain their original merchant after shared routing is enabled',async()=>{
      const retried=await payments.prepare(oldInput);assert.equal(retried.orderId,oldOrder.id);assert.equal(retried.stripeAccountId,original.stripeAccountId);
      assert.deepEqual((await oldOrder.reload()).toJSON(),oldSnapshot);
      provider.pay(oldOrder.checkoutSessionId);assert.equal((await payments.verify(buyer.id,oldOrder.id)).status,'paid');
    });
    await t.test('shared bookings still fulfill and refund through their original snapshot after the setting is disabled',async()=>{
      const sharedOrder=await models.Order.findOne({where:{eventId:events[2].id,stripeAccountId:shared.stripeAccountId}});
      const retryKey=sharedOrder.idempotencyKey;
      delete stripe.sandboxSharedAccountId;
      await assert.rejects(resolvePaymentAccount({models,event:events[2],stripe}),{code:'PAYMENTS_NOT_READY'});
      const retry=await payments.prepare({buyerUserId:buyer.id,eventId:events[2].id,idempotencyKey:retryKey,items:[{offeringId:offerings[2].id,quantity:1}]});
      assert.equal(retry.orderId,sharedOrder.id);assert.equal(retry.stripeAccountId,shared.stripeAccountId);
      provider.pay(sharedOrder.checkoutSessionId);assert.equal((await payments.verify(buyer.id,sharedOrder.id)).status,'paid');
      const refunds=createStripeRefundService({sequelize,models,stripe,permissions:createPermissionService(models)});
      const refunded=await refunds.requestRefund(owner.id,sharedOrder.id,{reason:'Shared sandbox refund',idempotencyKey:randomUUID()});
      assert.equal(refunded.status,'succeeded');assert.equal((await sharedOrder.reload()).stripeAccountId,shared.stripeAccountId);
      assert.equal((await models.Refund.findByPk(refunded.refundId)).stripeAccountId,shared.stripeAccountId);
      assert.equal((await resolvePaymentAccount({models,event:events[1],stripe})).id,original.id);
    });
    await t.test('payment totals retain verified shared purchases without mixing businesses or trusting malformed snapshots',async()=>{
      const overview=require('../src/services/business-payment-overview-service').createBusinessPaymentOverviewService({models});
      const sharedOrder=await models.Order.findOne({where:{eventId:events[2].id,stripeAccountId:shared.stripeAccountId}});
      assert.equal(stripe.sandboxSharedAccountId,undefined);
      const summary=await overview.overview(owner.id,businesses[2].id);
      assert.equal(summary.currencies[0].collectedCents,sharedOrder.totalCents);
      assert.equal(summary.currencies[0].refundedCents,sharedOrder.totalCents);
      assert.equal(summary.currencies[0].netCollectedCents,0);
      assert.equal(summary.currencies[0].refundedOrders,1);
      const canonical=await overview.overview(owner.id,businesses[0].id);
      assert.equal(canonical.currencies[0].collectedCents,0);
      assert.equal(canonical.pendingOrders,1);
      const other=await overview.overview(owner.id,businesses[1].id);
      assert.equal(other.currencies[0].collectedCents,oldOrder.totalCents);
      assert.equal(other.currencies[0].paidOrders,1);
      const snapshot=sharedOrder.pricingPlanSnapshot;
      try {
        for(const mismatch of [{sharedSandbox:'true'},{organizationId:businesses[0].id},{paymentAccountId:original.id},{stripeAccountId:original.stripeAccountId}]) {
          await sharedOrder.update({pricingPlanSnapshot:{...snapshot,merchant:{...snapshot.merchant,...mismatch}}});
          assert.deepEqual((await overview.overview(owner.id,businesses[2].id)).currencies,[]);
        }
      } finally {await sharedOrder.update({pricingPlanSnapshot:snapshot});}
    });
    await t.test('missing, disabled or no-longer-ready shared merchants fail closed instead of falling back to another account',async()=>{
      stripe.sandboxSharedAccountId='acct_missingintegration';
      await assert.rejects(resolvePaymentAccount({models,event:events[1],stripe}),{code:'PAYMENTS_NOT_READY'});
      stripe.sandboxSharedAccountId=shared.stripeAccountId;
      await shared.update({paymentsDisabledAt:new Date()});
      await assert.rejects(resolvePaymentAccount({models,event:events[1],stripe}),{code:'PAYMENTS_NOT_READY'});
      await shared.update({paymentsDisabledAt:null});
      const originalRetrieval=stripe.retrieveAccount;
      stripe.retrieveAccount=async id=>{const remote=await originalRetrieval(id);remote.configuration.merchant.capabilities.card_payments.status='restricted';return remote;};
      await assert.rejects(resolvePaymentAccount({models,event:events[1],stripe}),{code:'PAYMENTS_NOT_READY'});
    });
  } finally {await sequelize.close();}
});
