const { Op, QueryTypes } = require('sequelize');
const { DomainError, conflict, notFound } = require('../domain/errors');
const { calculatePricing } = require('../domain/pricing');
const { eventFinished, offeringSaleState } = require('../domain/event-policy');
const { effectiveFeeMode } = require('@nitewide/pricing');
const { fingerprint } = require('./checkout-service');
const { resolveAffiliate } = require('./affiliate-service');
const { assertActiveUser, assertActiveEvent, assertActiveOrganization } = require('./lifecycle-service');
const { mutationTransaction } = require('./mutation-transaction');
const { fulfillCheckout } = require('./checkout-fulfillment');
const { createNotificationJobService } = require('./notification-job-service');
const { resolvePaymentAccount } = require('./business-payment-account-service');
const { sharedSandboxOrderMatches } = require('../domain/shared-sandbox-merchant');
const { stripeApplicationFee } = require('../domain/stripe-pricing');
const { eventSummary } = require('./customer-account-service');
const { ensureCheckoutReminder } = require('./checkout-reminder-policy');
const { commissionSnapshot, effectiveCommissionMinimum } = require('../domain/commission-policy');
const { commissionEligibility } = require('../domain/commission-eligibility');
const { createCommissionLedgerService } = require('./commission-ledger-service');
const { isStripeMode, matchesStripeLivemode } = require('../payments/stripe-mode');

const summary = (order) => ({ orderId: order.id, status: order.status, verificationStatus: isStripeMode(order.providerMode) ? order.providerVerificationStatus || null : null });
const providerMismatch = () => new DomainError('Payment verification needs review', { code: 'PAYMENT_VERIFICATION_FAILED', status: 409 });
const providerId = (value) => typeof value === 'string' ? value : value?.id;

// A server-side account-scoped retrieval supplies these objects; callers and
// webhook payloads cannot supply this evidence to the fulfillment transaction.
function verifySession(order, session) {
  if (!session || session.id !== order.checkoutSessionId || !matchesStripeLivemode(session, order.providerMode) || session.mode !== 'payment'
    || session.metadata?.orderId !== order.id || session.client_reference_id !== order.id
    || session.amount_total !== order.totalCents || session.currency?.toUpperCase() !== order.currency.toUpperCase()) throw providerMismatch();
  if (session.payment_status !== 'paid' || session.status !== 'complete') return { paid: false, expired: session.status === 'expired' && session.payment_status === 'unpaid' };
  const intent = session.payment_intent, charge = intent?.latest_charge;
  if (!intent || typeof intent === 'string' || !matchesStripeLivemode(intent, order.providerMode) || intent.status !== 'succeeded'
    || intent.amount !== order.totalCents || intent.amount_received !== order.totalCents
    || intent.currency?.toUpperCase() !== order.currency.toUpperCase() || intent.metadata?.orderId !== order.id
    || (intent.application_fee_amount || 0) !== order.applicationFeeCents
    || intent.transfer_data || intent.on_behalf_of
    || !charge || typeof charge === 'string' || !matchesStripeLivemode(charge, order.providerMode) || charge.paid !== true || charge.captured !== true
    || charge.amount !== order.totalCents || charge.currency?.toUpperCase() !== order.currency.toUpperCase()
    || providerId(charge.payment_intent) !== intent.id || (charge.application_fee_amount || 0) !== order.applicationFeeCents
    || charge.refunded || charge.amount_refunded > 0) throw providerMismatch();
  return { paid: true, intent, charge };
}

function createStripeCheckoutService({ sequelize, models, stripe, checkout, applicationFeeForOrder = stripeApplicationFee,
  accountResolver = resolvePaymentAccount, now = () => new Date(), customerAppUrl = 'http://localhost:5173',
  individualProfiles = null, email = null, notificationJobs = createNotificationJobService({ sequelize, models, now }) }) {
  const tx = (work) => mutationTransaction(sequelize, work);
  function enabled() { if (!stripe?.enabled || !isStripeMode(stripe.mode)) throw new DomainError('Payments are unavailable', { code: 'PAYMENTS_NOT_ENABLED', status: 503 }); }
  function assertOrderMode(order) { if (order.providerMode !== stripe.mode || !isStripeMode(order.providerMode)) throw providerMismatch(); }
  const recipientId = affiliate => affiliate.eventAffiliate?.userId || affiliate.orgAffiliate?.userId;
  // Recognize previously ready server evidence without treating its old age as
  // current readiness. Disabled/disconnected bindings remain intentionally zero.
  const previouslyReady = affiliate => affiliate.individualProfile?.verifiedAt && commissionEligibility({
    userId: recipientId(affiliate), individualProfile: affiliate.individualProfile, now: affiliate.individualProfile.verifiedAt, mode: stripe.mode,
  }).eligible;
  const recipientUnavailable = () => new DomainError('Commission recipient verification is temporarily unavailable. Retry checkout shortly.', {
    code: 'COMMISSION_RECIPIENT_VERIFICATION_UNAVAILABLE', status: 503, details: { retryable: true },
  });
  async function preflightRecipient(input, event, offerings) {
    if (!input.affiliateCode) return;
    assertActiveUser(await models.User.findByPk(input.buyerUserId));
    await assertActiveEvent(models, event);
    // Read-only attribution resolution: neither browser readiness nor a supplied
    // account id is accepted, and preflight cannot create event assignments.
    const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: now(), persist: false, mode: stripe.mode });
    if (recipientId(affiliate) === input.buyerUserId) throw conflict('Self referrals cannot earn commission', 'SELF_REFERRAL');
    const organization = await models.Organization.findByPk(event.organizationId);
    const subtotal = input.items.reduce((sum, item) => sum + (offerings.find(o => o.id === item.offeringId)?.priceCents || 0) * item.quantity, 0);
    if (affiliate.configuredCommissionBps <= 0 || subtotal < effectiveCommissionMinimum(event, organization) || affiliate.commissionEligibility.eligible) return;
    const profile = affiliate.individualProfile;
    if (!profile?.stripeAccountId || profile.provider !== 'stripe' || profile.providerMode !== stripe.mode || profile.lifecycleState !== 'active'
      || profile.paymentsDisabledAt || profile.deauthorizedAt || profile.disconnectStatus && profile.disconnectStatus !== 'none') return;
    const wasReady = previouslyReady(affiliate);
    try {
      if (!individualProfiles?.synchronizeTrusted) { if (wasReady) throw recipientUnavailable(); return; }
      await individualProfiles.synchronizeTrusted(profile.stripeAccountId);
    } catch (error) {
      if (wasReady) throw recipientUnavailable();
      // A genuinely unonboarded person continues with the documented zero-rate
      // policy. A previously verified recipient may never silently lose earnings
      // merely because retrieval failed.
    }
  }
  async function buyerOrder(buyerUserId, orderId) {
    const order = await models.Order.findOne({ where: { id: orderId, buyerUserId } });
    if (!order) throw notFound('Order');
    assertActiveUser(await models.User.findByPk(buyerUserId));
    return order;
  }
  async function lockedOrder(orderId, transaction) {
    // Event-first ordering agrees with checkout/editor locks and avoids a
    // webhook/order lock inversion while several buyers share inventory.
    const identity = await models.Order.findByPk(orderId, { attributes: ['eventId'], transaction });
    if (!identity) throw notFound('Order');
    const event = await models.Event.findByPk(identity.eventId, { transaction, lock: transaction.LOCK.UPDATE });
    const order = await models.Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    const items = await models.OrderItem.findAll({ where: { orderId }, order: [['offeringId', 'ASC']], transaction });
    const offerings = await models.Offering.findAll({ where: { id: items.map((item) => item.offeringId) }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    return { order, event, items, offerings };
  }
  async function releaseReservation({ order, items, offerings }, transaction) {
    if (order.reservationReleasedAt) return;
    for (const item of items) {
      const offering = offerings.find((value) => value.id === item.offeringId);
      if (!offering || offering.quantityReserved < item.quantity) throw conflict('Inventory reservation needs review', 'RESERVATION_MISMATCH');
      await offering.increment('quantityReserved', { by: -item.quantity, transaction });
    }
    await order.update({ reservationReleasedAt: now() }, { transaction });
  }
  async function settle(orderId, session) {
    return tx(async (transaction) => {
      const state = await lockedOrder(orderId, transaction), { order, event, items, offerings } = state;
      enabled();
      assertOrderMode(order);
      if (order.status !== 'pending' || order.providerVerificationStatus === 'review') return summary(order);
      let evidence;
      try { evidence = verifySession(order, session); } catch (error) {
        await order.update({ providerVerificationStatus: 'review' }, { transaction });
        await models.AuditLog.create({ organizationId: event.organizationId, entityType: 'Order', entityId: order.id, action: 'payment.verification_review', after: { code: error.code } }, { transaction });
        return summary(order);
      }
      if (evidence.expired) {
        await releaseReservation(state, transaction);
        await order.update({ status: 'cancelled', providerVerificationStatus: 'verified' }, { transaction });
        return summary(order);
      }
      if (!evidence.paid) return summary(order);
      // A cancelled/archived/finished event or changed merchant cannot yield a
      // usable pass, even if the original provider reservation later succeeds.
      let admissionAllowed = event && event.status === 'published' && !eventFinished(event, now());
      try { if (admissionAllowed) await assertActiveEvent(models, event, transaction); } catch { admissionAllowed = false; }
      const account = await models.PaymentAccount.findByPk(order.paymentAccountId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' });
      if (!account || account.stripeAccountId !== order.stripeAccountId || account.mode !== order.providerMode
        || account.lifecycleState !== 'active' || (account.organizationId !== event.organizationId && !sharedSandboxOrderMatches(order, account, event))) admissionAllowed = false;
      if (account && account.organizationId !== event.organizationId && sharedSandboxOrderMatches(order, account, event)) {
        try { await assertActiveOrganization(models,account.organizationId,transaction); }
        catch (error) { if (!(error instanceof DomainError)) throw error; admissionAllowed=false; }
      }
      if (!admissionAllowed || order.reservationReleasedAt || offerings.length !== items.length
        || items.some((item) => {
          const offering = offerings.find((value) => value.id === item.offeringId);
          return !offering || offering.isActive === false || offering.quantityReserved < item.quantity;
        })) {
        await order.update({ providerVerificationStatus: 'review', stripePaymentIntentId: evidence.intent.id, stripeChargeId: evidence.charge.id }, { transaction });
        await models.Payment.findOrCreate({ where: { provider: 'stripe', providerReference: evidence.intent.id }, defaults: { orderId: order.id,
          status: 'succeeded', amountCents: order.totalCents, currency: order.currency, processedAt: now(), metadata: { stripeAccountId: order.stripeAccountId, admissionWithheld: true } }, transaction });
        await models.AuditLog.create({ organizationId: event?.organizationId, entityType: 'Order', entityId: order.id, action: 'payment.closed_event_review', after: { paymentIntentId: evidence.intent.id } }, { transaction });
        return summary(order);
      }
      const lines = items.map((item) => ({ item, offering: offerings.find((value) => value.id === item.offeringId), quantity: item.quantity, lineTotalCents: item.lineTotalCents }));
      const affiliate = {
        eventAffiliate: order.eventAffiliateId ? await models.EventAffiliate.findByPk(order.eventAffiliateId, { transaction }) : null,
        orgAffiliate: order.orgAffiliateId ? await models.OrgAffiliate.findByPk(order.orgAffiliateId, { transaction }) : null,
      };
      await fulfillCheckout({ models, order, event, lines, affiliate, provider: 'stripe', providerReference: evidence.intent.id,
        reserved: true, current: now(), transaction, email, customerAppUrl, notificationJobs });
      await order.update({ status: 'paid', paidAt: now(), providerVerificationStatus: 'verified', reservationReleasedAt: now(),
        stripePaymentIntentId: evidence.intent.id, stripeChargeId: evidence.charge.id }, { transaction });
      await createCommissionLedgerService({ sequelize, models, now }).recordPaidOrder({ order, event, transaction });
      return summary(order);
    });
  }
  async function ensureSession(order) {
    assertOrderMode(order);
    if (order.checkoutSessionId) return stripe.retrieveCheckoutSession(order.checkoutSessionId, { stripeAccount: order.stripeAccountId, expand: ['payment_intent.latest_charge'] });
    const params = order.pricingPlanSnapshot?.providerSessionParams;
    const preparedAt = new Date(order.pricingPlanSnapshot?.providerSessionPreparedAt).getTime();
    const age = now().getTime() - preparedAt;
    // Never change original parameters to bypass Stripe's expiry minimum or
    // recreate an unknown session outside its idempotency retention window.
    // Even an accepted-but-lost session is held for manual reconciliation once
    // its original create parameters are no longer safely replayable.
    if (!params || !Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000
      || !Number.isInteger(params.expires_at) || params.expires_at * 1000 - now().getTime() <= 30 * 60 * 1000) {
      await tx(async transaction => {
        await models.Event.findByPk(order.eventId, { transaction, lock: transaction.LOCK.UPDATE });
        const current = await models.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (current.checkoutSessionId || current.status !== 'pending' || current.providerVerificationStatus === 'review') return;
        await current.update({ providerVerificationStatus: 'review' }, { transaction });
        await models.AuditLog.create({ entityType: 'Order', entityId: order.id, action: 'payment.creation_recovery_review',
          after: { code: 'CHECKOUT_CREATION_RECOVERY_UNSAFE', reservationRetained: true } }, { transaction });
      });
      await order.reload();
      if (order.checkoutSessionId) return stripe.retrieveCheckoutSession(order.checkoutSessionId, { stripeAccount: order.stripeAccountId, expand: ['payment_intent.latest_charge'] });
      return null;
    }
    const session = await stripe.createCheckoutSession(structuredClone(params),
    { stripeAccount: order.stripeAccountId, idempotencyKey: `checkout/${order.id}` });
    if (!session?.id || !matchesStripeLivemode(session, order.providerMode) || session.metadata?.orderId !== order.id) throw providerMismatch();
    await tx(async (transaction) => {
      const current = await models.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      assertOrderMode(current);
      if (current.checkoutSessionId && current.checkoutSessionId !== session.id) throw providerMismatch();
      await current.update({ checkoutSessionId: session.id }, { transaction });
    });
    return session;
  }
  async function reconcileOrder(order) {
    if (order.status !== 'pending' || !isStripeMode(order.providerMode) || order.providerVerificationStatus === 'review') return summary(order);
    enabled();
    assertOrderMode(order);
    try {
      const session = await ensureSession(order);
      if (!session) return summary(order);
      return await settle(order.id, session);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return { ...summary(order), retryable: true };
    }
  }
  async function prepare(input) {
    if (input.payment) throw new DomainError('Payment confirmation must come from Stripe', { code: 'UNTRUSTED_PAYMENT' });
    const requestFingerprint = fingerprint(input);
    // Refresh merchant capabilities outside all inventory locks. The cached
    // evidence is checked again under locks before reserving a cart.
    const eventPreview = await models.Event.findByPk(input.eventId);
    if (!eventPreview) throw notFound('Event');
    const previewOfferings = await models.Offering.findAll({ where: { eventId: input.eventId, id: input.items.map((item) => item.offeringId) } });
    if (previewOfferings.length && previewOfferings.every((offering) => offering.priceCents === 0)) {
      const result = await checkout(input);
      return summary(result.order);
    }
    enabled();
    const previous = await models.Order.findOne({ where: { buyerUserId: input.buyerUserId, idempotencyKey: input.idempotencyKey } });
    if (!previous) {
      await accountResolver({ models, event: eventPreview, stripe });
      await preflightRecipient(input, eventPreview, previewOfferings);
    }
    let order = await tx(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', { replacements: { key: `checkout/${input.buyerUserId}/${input.idempotencyKey}` }, transaction, type: QueryTypes.SELECT });
      const buyer = assertActiveUser(await models.User.findByPk(input.buyerUserId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' }));
      const existing = await models.Order.findOne({ where: { buyerUserId: input.buyerUserId, idempotencyKey: input.idempotencyKey }, transaction });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw conflict('This checkout key belongs to a different cart or referral', 'IDEMPOTENCY_CONFLICT');
        return existing;
      }
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      await assertActiveEvent(models, event, transaction);
      if (event.status !== 'published' || eventFinished(event, now())) throw conflict('Event is not on sale', 'EVENT_NOT_ON_SALE');
      const account = await accountResolver({ models, event, transaction, stripe, refresh: false });
      const quantities = new Map();
      for (const item of input.items) quantities.set(item.offeringId, (quantities.get(item.offeringId) || 0) + item.quantity);
      const offerings = await models.Offering.findAll({ where: { eventId: event.id }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      const selected = offerings.filter((offering) => quantities.has(offering.id));
      if (selected.length !== quantities.size) throw notFound('Offering');
      if (new Set(selected.map((offering) => offering.currency)).size !== 1) throw conflict('Mixed currencies are not supported', 'MIXED_CURRENCY');
      const lines = selected.map((offering) => {
        const quantity = quantities.get(offering.id);
        if (quantity < offering.minPerOrder || quantity > offering.maxPerOrder || offeringSaleState(offering, offerings, now()) !== 'on_sale') throw conflict('Offering is not currently available', 'OFFERING_NOT_ON_SALE');
        if (offering.inventoryMode === 'finite' && offering.quantitySold + offering.quantityReserved + quantity > offering.quantityTotal) throw conflict('Not enough inventory', 'INSUFFICIENT_INVENTORY');
        return { offering, quantity };
      });
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: now(), transaction, lock: transaction.LOCK.UPDATE, mode: stripe.mode });
      if (affiliate.eventAffiliate?.userId === input.buyerUserId || affiliate.orgAffiliate?.userId === input.buyerUserId) throw conflict('Self referrals cannot earn commission', 'SELF_REFERRAL');
      const organization = await models.Organization.findByPk(event.organizationId, { transaction });
      const subtotalCents = lines.reduce((sum, { offering, quantity }) => sum + offering.priceCents * quantity, 0);
      // Re-resolved membership/rate and the persisted personal profile are
      // locked above. A delayed refresh, changed binding or exhausted freshness
      // window cannot freeze an accidentally zero commission attempt.
      if (affiliate.configuredCommissionBps > 0 && subtotalCents >= effectiveCommissionMinimum(event, organization)
        && !affiliate.commissionEligibility.eligible && previouslyReady(affiliate)) throw recipientUnavailable();
      const commission = commissionSnapshot({ event, organization, affiliate, subtotalCents, currency: selected[0].currency, now: now() });
      const pricing = calculatePricing({ subtotalCents, items: lines.map(({ offering, quantity }) => ({ unitPriceCents: offering.priceCents, quantity, feeMode: effectiveFeeMode(event.feeMode || 'buyer', offering.feeMode || 'inherit') })), currency: selected[0].currency, planTier: organization.planTier, commissionBps: commission.effectiveCommissionBps, now: now() });
      if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== pricing.totalCents) throw conflict('Pricing changed', 'PRICE_CHANGED');
      if (lines.length + (pricing.platformFeeCents > 0 ? 1 : 0) > 100) throw new DomainError('This cart has too many offerings', { code: 'CHECKOUT_TOO_LARGE', status: 422 });
      const feeDecision = applicationFeeForOrder(pricing, stripe.mode);
      const applicationFeeCents = typeof feeDecision === 'number' ? feeDecision : feeDecision.applicationFeeCents;
      if (!Number.isSafeInteger(applicationFeeCents) || applicationFeeCents < 0 || applicationFeeCents > pricing.totalCents) throw conflict('Application fee needs review', 'INVALID_APPLICATION_FEE');
      const created = await models.Order.create({ buyerUserId: input.buyerUserId, eventId: event.id, status: 'pending', currency: selected[0].currency,
        subtotalCents, ...pricing, commissionSnapshot: commission, idempotencyKey: input.idempotencyKey, requestFingerprint, paymentAccountId: account.id, stripeAccountId: account.stripeAccountId,
        applicationFeeCents, providerMode: stripe.mode, providerVerificationStatus: 'pending', reservationExpiresAt: new Date(now().getTime() + 35 * 60 * 1000),
        orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id,
        pricingPlanSnapshot: { ...pricing.pricingPlanSnapshot, demo: false, providerCustomerEmail: buyer.email, commissionBps: commission.effectiveCommissionBps,
          configuredCommissionBps: affiliate.configuredCommissionBps, commissionEligibility: affiliate.commissionEligibility, stripeFeeDecision: feeDecision, economicsBasis: stripe.mode === 'test' ? 'modeled_sandbox_economics' : 'modeled_provider_economics', merchant: { paymentAccountId: account.id, stripeAccountId: account.stripeAccountId, organizationId: event.organizationId,
            ...(stripe.mode === 'test' && stripe.sandboxSharedAccountId === account.stripeAccountId ? { sharedSandbox: true } : {}) } } }, { transaction });
      const returnUrl = new URL(customerAppUrl); returnUrl.searchParams.set('paymentOrder', created.id); returnUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
      const lineItems = lines.map(({ offering, quantity }) => ({ quantity, price_data: { currency: created.currency.toLowerCase(), unit_amount: offering.priceCents, product_data: { name: offering.name } } }));
      if (created.platformFeeCents) lineItems.push({ quantity: 1, price_data: { currency: created.currency.toLowerCase(), unit_amount: created.platformFeeCents, product_data: { name: 'Booking fee' } } });
      await created.update({ pricingPlanSnapshot: { ...created.pricingPlanSnapshot, providerSessionPreparedAt: now().toISOString(),
        providerSessionParams: { ui_mode: 'elements', mode: 'payment', ...structuredClone(stripe.checkoutPaymentMethodOptions), line_items: lineItems,
          customer_email: buyer.email, client_reference_id: created.id, metadata: { orderId: created.id },
          payment_intent_data: { application_fee_amount: applicationFeeCents, metadata: { orderId: created.id } },
          return_url: returnUrl.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'), expires_at: Math.floor(new Date(created.reservationExpiresAt).getTime() / 1000) } } }, { transaction });
      for (const { offering, quantity } of lines) {
        await models.OrderItem.create({ orderId: created.id, offeringId: offering.id, nameSnapshot: offering.name, kindSnapshot: offering.kind, quantity, entriesPerUnitSnapshot: offering.entriesPerUnit, unitPriceCents: offering.priceCents, lineTotalCents: offering.priceCents * quantity }, { transaction });
        await offering.increment('quantityReserved', { by: quantity, transaction });
      }
      await ensureCheckoutReminder(models, created, event, transaction);
      return created;
    });
    return paymentForm(order);
  }
  async function paymentForm(order) {
    if (order.status !== 'pending' || order.providerVerificationStatus === 'review') return summary(order);
    enabled();
    try {
      const session = await ensureSession(order);
      if (!session) return summary(order);
      const result = await settle(order.id, session);
      return { ...result, ...(result.status === 'pending' && result.verificationStatus !== 'review' ? { clientSecret: session.client_secret, stripeAccountId: order.stripeAccountId, expiresAt: order.reservationExpiresAt } : {}) };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return { ...summary(order), retryable: true };
    }
  }
  async function resume(buyerUserId, orderId) {
    const order = await buyerOrder(buyerUserId, orderId);
    if (!isStripeMode(order.providerMode) || order.providerMode !== stripe.mode) throw conflict('This booking does not use the active Stripe checkout environment', 'CHECKOUT_NOT_RESUMABLE');
    // Recover only this buyer's original order/session. Never re-price, change
    // its merchant or generate a replacement checkout key to resume payment.
    const result = await paymentForm(order);
    const [event, items] = await Promise.all([
      models.Event.findByPk(order.eventId, { include: [
        { model: models.Location, as: 'location' },
        { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'planTier'] },
      ] }),
      models.OrderItem.findAll({ where: { orderId: order.id }, order: [['id', 'ASC']] }),
    ]);
    return { ...result, booking: { idempotencyKey: order.idempotencyKey, event: eventSummary(event),
      subtotalCents: order.subtotalCents, totalCents: order.totalCents, currency: order.currency,
      items: items.map(item => ({ offeringId: item.offeringId, name: item.nameSnapshot, kind: item.kindSnapshot,
        quantity: item.quantity, unitPriceCents: item.unitPriceCents })) } };
  }
  async function lookup(buyerUserId, idempotencyKey) {
    const order = await models.Order.findOne({ where: { buyerUserId, idempotencyKey } });
    if (!order) throw notFound('Checkout attempt');
    assertActiveUser(await models.User.findByPk(buyerUserId));
    return reconcileOrder(order);
  }
  async function verify(buyerUserId, orderId) { return reconcileOrder(await buyerOrder(buyerUserId, orderId)); }
  async function cancel(buyerUserId, orderId) {
    const order = await buyerOrder(buyerUserId, orderId);
    if (order.status !== 'pending' || order.providerVerificationStatus === 'review') return summary(order);
    enabled();
    let session;
    try { session = await ensureSession(order); } catch { return { ...summary(order), retryable: true }; }
    if (!session) return summary(order);
    verifySession(order, session);
    try { await stripe.expireCheckoutSession(session.id, { stripeAccount: order.stripeAccountId }); } catch { /* Independently retrieve even when expiry raced payment. */ }
    order.checkoutSessionId = session.id;
    return reconcileOrder(order);
  }
  async function reconcileExpired({ limit = 25 } = {}) {
    enabled();
    const orders = await models.Order.findAll({ where: { status: 'pending', providerMode: stripe.mode, providerVerificationStatus: 'pending', reservationExpiresAt: { [Op.lte]: now() } }, order: [['reservationExpiresAt', 'ASC']], limit: Math.min(100, Math.max(1, limit)) });
    const results = [];
    // No local expiry releases stock. Unknown creation outcomes are retried
    // with immutable original params and the original provider idempotency key.
    for (const order of orders) {
      try { results.push(await reconcileOrder(order)); }
      catch (error) { results.push({ ...summary(order), retryable: true, code: error.code || 'PAYMENT_RECONCILIATION_FAILED' }); }
    }
    return results;
  }
  return { prepare, resume, lookup, verify, cancel, reconcileOrder, reconcileExpired, sweepReservations: reconcileExpired, settle };
}
module.exports = { createStripeCheckoutService, verifySession, providerId, summary };
