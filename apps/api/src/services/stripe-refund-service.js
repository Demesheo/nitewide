const { QueryTypes } = require('sequelize');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');
const { providerId } = require('./stripe-checkout-service');
const { assertFinanceAccess } = require('./business-payment-account-service');

const refundSummary = (refund) => ({ refundId: refund.id, orderId: refund.orderId, status: refund.status });
function verifyRefund(order, refund, evidence, charge, applicationFee) {
  // Refund objects have no livemode field. Sandbox evidence comes from the
  // independently retrieved account-scoped Charge and guarded test adapter.
  return evidence?.id === refund.providerReference && evidence.livemode !== true
    && evidence.status === 'succeeded' && evidence.amount === order.totalCents
    && evidence.currency?.toUpperCase() === order.currency.toUpperCase()
    && providerId(evidence.payment_intent) === order.stripePaymentIntentId
    && providerId(evidence.charge) === order.stripeChargeId && evidence.metadata?.refundId === refund.id
    && evidence.metadata?.orderId === order.id && charge?.id === order.stripeChargeId
    && charge.livemode === false && charge.refunded === true && charge.amount_refunded === order.totalCents
    && (order.applicationFeeCents === 0 || (applicationFee?.amount === order.applicationFeeCents && applicationFee.livemode === false
      && applicationFee.currency?.toUpperCase() === order.currency.toUpperCase()
      && applicationFee.refunded === true && applicationFee.amount_refunded === order.applicationFeeCents
      && providerId(applicationFee.account) === order.stripeAccountId && providerId(applicationFee.charge) === order.stripeChargeId));
}
function createStripeRefundService({ sequelize, models, stripe, permissions, now = () => new Date() }) {
  function enabled() { if (!stripe?.enabled || stripe.mode !== 'test') throw new DomainError('Sandbox refunds unavailable', { code: 'PAYMENTS_NOT_ENABLED', status: 503 }); }
  async function reconcile(refund) {
    enabled();
    if (refund.status === 'succeeded') return refundSummary(refund);
    const order = await models.Order.findByPk(refund.orderId);
    if (!order || order.providerMode !== 'test' || refund.stripeAccountId !== order.stripeAccountId
      || refund.paymentAccountId !== order.paymentAccountId || refund.amountCents !== order.totalCents
      || refund.currency.toUpperCase() !== order.currency.toUpperCase() || !refund.approvedByUserId
      || !order.stripePaymentIntentId || !order.stripeChargeId
      || !['paid', 'pending'].includes(order.status)
      || (order.status === 'pending' && order.providerVerificationStatus !== 'review')) {
      throw conflict('Approved refund binding needs review', 'REFUND_STATE_CONFLICT');
    }
    if (!refund.providerReference) {
      // Do not replay an aged creation after the provider's idempotency
      // retention window. An unresolved approval then requires review.
      const age = now().getTime() - new Date(refund.createdAt).getTime();
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000) {
        throw conflict('Refund creation recovery window elapsed', 'REFUND_STATE_CONFLICT');
      }
      let created;
      try {
        // This is the original immutable approval, not a new refund request.
        // Stripe idempotency recovers a response lost after provider execution.
        created = await stripe.createRefund({ payment_intent: order.stripePaymentIntentId, amount: refund.amountCents,
          refund_application_fee: true, metadata: { refundId: refund.id, orderId: order.id } },
        { stripeAccount: refund.stripeAccountId, idempotencyKey: `refund/${refund.id}` });
      } catch { return { ...refundSummary(refund), retryable: true }; }
      if (!created?.id || created.livemode === true || created.metadata?.refundId !== refund.id
        || created.metadata?.orderId !== order.id) throw conflict('Refund provider response needs review', 'REFUND_VERIFICATION_FAILED');
      refund = await mutationTransaction(sequelize, async (transaction) => {
        const locked = await models.Refund.findByPk(refund.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (locked.providerReference && locked.providerReference !== created.id) throw conflict('Refund reference mismatch', 'REFUND_VERIFICATION_FAILED');
        if (!locked.providerReference) await locked.update({ providerReference: created.id }, { transaction });
        return locked;
      });
      if (refund.status === 'succeeded') return refundSummary(refund);
    }
    let evidence, charge, fee;
    try {
      evidence = await stripe.retrieveRefund(refund.providerReference, { stripeAccount: order.stripeAccountId });
      charge = await stripe.retrieveCharge(order.stripeChargeId, { stripeAccount: order.stripeAccountId });
      if (order.applicationFeeCents > 0 && charge.application_fee) fee = await stripe.retrieveApplicationFee(providerId(charge.application_fee), {});
    } catch { return { ...refundSummary(refund), retryable: true }; }
    if (evidence.status !== 'succeeded') return { ...refundSummary(refund), retryable: true };
    if (!verifyRefund(order, refund, evidence, charge, fee)) throw conflict('Provider refund needs review', 'REFUND_VERIFICATION_FAILED');
    return mutationTransaction(sequelize, async (transaction) => {
      const event = await models.Event.findByPk(order.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const lockedOrder = await models.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      const lockedRefund = await models.Refund.findByPk(refund.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (lockedRefund.status === 'succeeded') return refundSummary(lockedRefund);
      if (!['paid', 'pending'].includes(lockedOrder.status)) throw conflict('Order refund needs review', 'REFUND_STATE_CONFLICT');
      const items = await models.OrderItem.findAll({ where: { orderId: order.id }, order: [['offeringId', 'ASC']], transaction });
      const offerings = await models.Offering.findAll({ where: { id: items.map((item) => item.offeringId) }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      if (lockedOrder.status === 'pending' && !lockedOrder.reservationReleasedAt) {
        for (const item of items) {
          const offering = offerings.find((value) => value.id === item.offeringId);
          if (!offering || offering.quantityReserved < item.quantity) throw conflict('Reservation refund needs review', 'RESERVATION_MISMATCH');
          await offering.increment('quantityReserved', { by: -item.quantity, transaction });
        }
      }
      // Sold counters describe historical sales; refund does not silently
      // reopen sale inventory or authorize replacement admissions.
      await models.Ticket.update({ status: 'void' }, { where: { orderItemId: items.map((item) => item.id) }, transaction });
      await models.Payment.update({ status: 'refunded' }, { where: { orderId: order.id, provider: 'stripe' }, transaction });
      await lockedOrder.update({ status: 'refunded', providerVerificationStatus: 'verified', reservationReleasedAt: lockedOrder.reservationReleasedAt || now() }, { transaction });
      await lockedRefund.update({ status: 'succeeded' }, { transaction });
      await models.AuditLog.create({ actorUserId: lockedRefund.requestedByUserId, organizationId: event.organizationId, entityType: 'Order', entityId: order.id, action: 'order.refunded', after: { refundId: refund.id, amountCents: order.totalCents, reason: lockedRefund.reason, applicationFeeRefunded: true } }, { transaction });
      return refundSummary(lockedRefund);
    });
  }
  async function requestRefund(userId, orderId, input, { internalOverride = false } = {}) {
    enabled();
    if (!input?.reason?.trim() || input.reason.length > 500 || !input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new DomainError('A reason and retry key are required', { code: 'INVALID_REFUND_REQUEST' });
    const refund = await mutationTransaction(sequelize, async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', { replacements: { key: `refund/${orderId}` }, transaction, type: QueryTypes.SELECT });
      const order = await models.Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!order) throw notFound('Order');
      const event = await models.Event.findByPk(order.eventId, { transaction });
      if (internalOverride) await permissions.assertInternalPermission(userId, 'finance.manage', transaction);
      else await assertFinanceAccess(models, userId, event.organizationId, transaction);
      if (order.providerMode !== 'test' || !order.stripePaymentIntentId || !order.stripeChargeId || !['paid', 'pending', 'refunded'].includes(order.status)) throw conflict('Only verified provider payments can be refunded', 'REFUND_NOT_AVAILABLE');
      if (order.status === 'pending' && order.providerVerificationStatus !== 'review') throw conflict('Payment is not confirmed', 'REFUND_NOT_AVAILABLE');
      const existing = await models.Refund.findOne({ where: { orderId }, transaction });
      if (existing) {
        if (existing.idempotencyKey !== input.idempotencyKey || existing.reason !== input.reason.trim()) throw conflict('A refund request already exists for this order', 'REFUND_IDEMPOTENCY_CONFLICT');
        return existing;
      }
      const created = await models.Refund.create({ orderId, paymentAccountId: order.paymentAccountId, stripeAccountId: order.stripeAccountId,
        amountCents: order.totalCents, currency: order.currency, status: 'pending', idempotencyKey: input.idempotencyKey,
        requestedByUserId: userId, approvedByUserId: userId, adminOverride: internalOverride, reason: input.reason.trim() }, { transaction });
      await models.AuditLog.create({ actorUserId: userId, organizationId: event.organizationId, entityType: 'Refund', entityId: created.id, action: internalOverride ? 'refund.admin_override_requested' : 'refund.merchant_approved', after: { orderId, reason: created.reason, amountCents: order.totalCents } }, { transaction });
      return created;
    });
    if (refund.status === 'succeeded') return refundSummary(refund);
    return reconcile(refund);
  }
  async function sweepPendingRefunds({ limit = 25 } = {}) {
    enabled();
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 25;
    const pending = await models.Refund.findAll({ where: { status: 'pending' }, order: [['updatedAt', 'ASC'], ['id', 'ASC']], limit: boundedLimit });
    const results = [];
    for (const refund of pending) {
      try { results.push(await reconcile(refund)); }
      catch (error) {
        const code = ['REFUND_STATE_CONFLICT', 'REFUND_VERIFICATION_FAILED', 'RESERVATION_MISMATCH'].includes(error.code)
          ? error.code : 'REFUND_RECONCILIATION_PENDING';
        results.push({ ...refundSummary(refund), retryable: true, code });
      }
      // Rotate unresolved work so a permanently unavailable provider object
      // cannot starve later approvals. Never change monetary state here.
      await models.Refund.update({ updatedAt: now() }, { where: { id: refund.id, status: 'pending' } });
    }
    return results;
  }
  async function reconcileRefundEvent(event, account) {
    enabled();
    let reference = event.data.object.id;
    let externalCharge;
    if (event.type === 'charge.refunded') {
      externalCharge = await stripe.retrieveCharge(reference, { stripeAccount: account.stripeAccountId });
      if (externalCharge?.id !== reference) throw conflict('Charge reference mismatch', 'REFUND_VERIFICATION_FAILED');
      reference = externalCharge.refunds?.data?.find((refund) => refund.metadata?.refundId)?.id;
      if (!reference) return reconcileExternalRefund(event, account, externalCharge);
    }
    if (!reference) return;
    let refund = await models.Refund.findOne({ where: { providerReference: reference } });
    if (!refund) {
      const evidence = await stripe.retrieveRefund(reference, { stripeAccount: account.stripeAccountId });
      if (evidence?.id !== reference) throw conflict('Refund reference mismatch', 'REFUND_VERIFICATION_FAILED');
      refund = evidence.metadata?.refundId && await models.Refund.findOne({ where: { id: evidence.metadata.refundId, stripeAccountId: account.stripeAccountId } });
      if (!refund) {
        const charge = await stripe.retrieveCharge(providerId(evidence.charge), { stripeAccount: account.stripeAccountId });
        if (charge?.id !== providerId(evidence.charge) || evidence.livemode === true || providerId(evidence.payment_intent) !== providerId(charge.payment_intent)
          || evidence.currency?.toUpperCase() !== charge.currency?.toUpperCase()) throw conflict('External refund binding needs review', 'REFUND_VERIFICATION_FAILED');
        return reconcileExternalRefund(event, account, charge);
      }
      if (evidence.livemode === true || evidence.metadata?.orderId !== refund.orderId) throw conflict('Refund binding needs review', 'REFUND_VERIFICATION_FAILED');
      if (refund.providerReference && refund.providerReference !== reference) throw conflict('Refund reference mismatch', 'REFUND_VERIFICATION_FAILED');
      await refund.update({ providerReference: reference });
    }
    if (!refund) throw notFound('Refund');
    const order = await models.Order.findByPk(refund.orderId);
    if (order.stripeAccountId !== account.stripeAccountId) throw notFound('Refund');
    return reconcile(refund);
  }
  async function reconcileExternalRefund(event, account, charge) {
    // Signed events only select a provider object. Independently retrieved
    // direct-account Charge evidence is bound to our immutable payment.
    const order = charge?.id && await models.Order.findOne({ where: { stripeChargeId: charge.id, stripeAccountId: account.stripeAccountId, providerMode: 'test' } });
    if (!order) return { ignored: true };
    if (charge.livemode !== false || providerId(charge.payment_intent) !== order.stripePaymentIntentId
      || charge.amount !== order.totalCents || charge.currency?.toUpperCase() !== order.currency.toUpperCase()
      || charge.application_fee_amount !== order.applicationFeeCents
      || charge.paid !== true || charge.captured !== true || !Number.isInteger(charge.amount_refunded)
      || charge.amount_refunded < 0 || charge.amount_refunded > order.totalCents) throw conflict('External charge binding needs review', 'REFUND_VERIFICATION_FAILED');
    let fee;
    if (order.applicationFeeCents > 0 && charge.application_fee) fee = await stripe.retrieveApplicationFee(providerId(charge.application_fee), {});
    const full = charge.refunded === true && charge.amount_refunded === order.totalCents
      && (order.applicationFeeCents === 0 || (fee?.livemode === false && fee.amount === order.applicationFeeCents
        && fee.currency?.toUpperCase() === order.currency.toUpperCase() && fee.refunded === true
        && fee.amount_refunded === order.applicationFeeCents && providerId(fee.account) === order.stripeAccountId
        && providerId(fee.charge) === order.stripeChargeId));
    return mutationTransaction(sequelize, async transaction => {
      const eventRow = await models.Event.findByPk(order.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      const locked = await models.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked.status === 'refunded') return { orderId: locked.id, status: 'succeeded' };
      if (!['paid', 'pending'].includes(locked.status)) throw conflict('External refund state needs review', 'REFUND_STATE_CONFLICT');
      const items = await models.OrderItem.findAll({ where: { orderId: order.id }, transaction });
      // Partial, unsettled or fee-incomplete refunds hold admissions for review.
      // Financial records are not represented as fully refunded until proven.
      if (full) await models.Ticket.update({ status: 'void' }, { where: { orderItemId: items.map(item => item.id) }, transaction });
      if (full && locked.status === 'pending' && !locked.reservationReleasedAt) {
        const offerings = await models.Offering.findAll({ where: { id: items.map(item => item.offeringId) }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
        for (const item of items) {
          const offering = offerings.find(value => value.id === item.offeringId);
          if (!offering || offering.quantityReserved < item.quantity) throw conflict('Reservation refund needs review', 'RESERVATION_MISMATCH');
          await offering.increment('quantityReserved', { by: -item.quantity, transaction });
        }
      }
      const alreadyReview = locked.providerVerificationStatus === 'review';
      await locked.update(full ? { status: 'refunded', providerVerificationStatus: 'verified', reservationReleasedAt: locked.reservationReleasedAt || now() }
        : { providerVerificationStatus: 'review' }, { transaction });
      if (full) await models.Payment.update({ status: 'refunded' }, { where: { orderId: order.id, provider: 'stripe' }, transaction });
      if (full || !alreadyReview) await models.AuditLog.create({ actorUserId: null, organizationId: eventRow.organizationId,
        entityType: 'Order', entityId: order.id, action: full ? 'order.external_refund_verified' : 'order.external_refund_review',
        after: { origin: 'stripe_provider_external', stripeEventId: event.id, stripeChargeId: charge.id,
          customerAmountRefundedCents: charge.amount_refunded, applicationFeeRefunded: full, approval: 'not_recorded_by_nitewide' } }, { transaction });
      return { orderId: order.id, status: full ? 'succeeded' : 'review', reviewRequired: !full };
    });
  }
  return { requestRefund, reconcile, reconcileRefundEvent, sweepPendingRefunds };
}
module.exports = { createStripeRefundService, verifyRefund };
