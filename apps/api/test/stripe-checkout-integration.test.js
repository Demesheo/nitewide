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
  let unavailable = false, loseCreationResponse = false, loseRefundResponse = false, creations = 0, refundCreations = 0;
  const check = () => { if (unavailable) throw new Error('Provider transport unavailable'); };
  const scoped = (session, options) => { assert.equal(options.stripeAccount, session.account); return structuredClone(session); };
  const stripe = { enabled: true, mode: 'test', checkoutPaymentMethodOptions: { payment_method_types: ['card'] },
    retrieveAccount: async id => ({ id, object: 'v2.core.account', livemode: false, applied_configurations: ['merchant'], dashboard: 'full',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe', requirements_collector: 'stripe' } },
      configuration: { merchant: { applied: true, capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } }),
    createCheckoutSession: async (params, options) => {
      check(); if (keys.has(options.idempotencyKey)) return scoped(sessions.get(keys.get(options.idempotencyKey)), options);
      const id = `cs_${namespace}${++creations}`, session = { id, account: options.stripeAccount, client_secret: `${id}_secret`, livemode: false,
        mode: params.mode, status: 'open', payment_status: 'unpaid', metadata: params.metadata, client_reference_id: params.client_reference_id,
        amount_total: params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0), currency: params.line_items[0].price_data.currency,
        fee: params.payment_intent_data.application_fee_amount, params };
      assert.equal(params.ui_mode, 'elements'); assert.deepEqual(params.payment_method_types, ['card']);
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
      check(); const key = `refund:${options.idempotencyKey}`; if (keys.has(key)) return structuredClone(refunds.get(keys.get(key)));
      assert.equal(params.refund_application_fee, true); assert.equal('reverse_transfer' in params, false);
      const charge = [...charges.values()].find(value => value.payment_intent === params.payment_intent);
      assert.equal(options.stripeAccount, charge.account);
      const id = `re_${++refundCreations}`, refund = { id, livemode: false, status: 'succeeded', amount: params.amount, currency: charge.currency,
        payment_intent: params.payment_intent, charge: charge.id, metadata: params.metadata };
      charge.refunded = true; charge.amount_refunded = params.amount;
      const fee = fees.get(charge.application_fee); fee.refunded = true; fee.amount_refunded = fee.amount;
      refunds.set(id, refund); keys.set(key, id);
      if (loseRefundResponse) { loseRefundResponse = false; throw new Error('Lost refund response'); }
      return structuredClone(refund);
    },
    retrieveRefund: async (id, options) => { check(); assert.equal(options.stripeAccount, charges.get(refunds.get(id).charge).account); return structuredClone(refunds.get(id)); },
    retrieveCharge: async (id, options) => { check(); assert.equal(options.stripeAccount, charges.get(id).account); return structuredClone(charges.get(id)); },
    retrieveApplicationFee: async id => { check(); return structuredClone(fees.get(id)); },
  };
  function pay(id) {
    const s = sessions.get(id), intentId = `pi_${id}`, chargeId = `ch_${id}`, feeId = `fee_${id}`;
    const charge = { id: chargeId, account: s.account, livemode: false, payment_intent: intentId, amount: s.amount_total, currency: s.currency,
      paid: true, captured: true, refunded: false, amount_refunded: 0, application_fee_amount: s.fee, application_fee: feeId };
    charges.set(chargeId, charge); fees.set(feeId, { id: feeId, livemode: false, currency: s.currency, amount: s.fee, amount_refunded: 0, refunded: false, account: s.account, charge: chargeId });
    s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = { id: intentId, livemode: false, status: 'succeeded', amount: s.amount_total,
      amount_received: s.amount_total, currency: s.currency, metadata: s.metadata, application_fee_amount: s.fee, latest_charge: charge };
  }
  return { stripe, sessions, refunds, charges, fees, thinEvents, pay, unavailable: value => { unavailable = value; }, loseNextRefund: () => { loseRefundResponse = true; }, loseNextCreation: () => { loseCreationResponse = true; }, creations: () => creations, refundCreations: () => refundCreations };
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
    });
    await t.test('paid evidence arriving after event closure goes to audited review without usable tickets', async () => {
      const attempt = await payments.prepare({ ...input, idempotencyKey: randomUUID(), items: [{ offeringId: offering.id, quantity: 1 }] });
      const pending = await models.Order.findByPk(attempt.orderId);
      provider.pay(pending.checkoutSessionId); await event.update({ lifecycleState: 'archived' });
      const result = await payments.verify(buyer, pending.id);
      assert.equal(result.verificationStatus, 'review'); assert.equal(result.status, 'pending');
      assert.equal(await models.Ticket.count(), 2); assert.equal(await models.Payment.count(), 2);
      assert.equal(await models.AuditLog.count({ where: { action: 'payment.closed_event_review' } }), 1);
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
test('disabled merchant stops new paid sessions but preserves in-flight checkout and free bookings',{timeout:30000},checkDisabledMerchant);
