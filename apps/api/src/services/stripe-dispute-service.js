const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { conflict, DomainError } = require('../domain/errors');
const { providerId } = require('./stripe-checkout-service');
const { mutationTransaction } = require('./mutation-transaction');

const CLOSED = new Set(['won','lost','warning_closed','prevented']);
const HELD = ['warning_needs_response','warning_under_review','needs_response','under_review','lost'];
const STATUSES = new Set([...CLOSED,...HELD]);
function verifyDispute(order, dispute, charge, intent) {
  return dispute?.object === 'dispute' && charge?.object === 'charge' && intent?.object === 'payment_intent'
    && STATUSES.has(dispute.status) && dispute.livemode === false && charge.livemode === false && intent.livemode === false
    && providerId(dispute.charge) === order.stripeChargeId && charge.id === order.stripeChargeId
    && providerId(dispute.payment_intent) === order.stripePaymentIntentId && providerId(charge.payment_intent) === order.stripePaymentIntentId
    && intent.id === order.stripePaymentIntentId && intent.metadata?.orderId === order.id
    && intent.status === 'succeeded' && providerId(intent.latest_charge) === order.stripeChargeId
    && charge.paid === true && charge.captured === true && charge.amount === order.totalCents && intent.amount === order.totalCents
    && charge.application_fee_amount === order.applicationFeeCents && intent.application_fee_amount === order.applicationFeeCents
    && [dispute.currency,charge.currency,intent.currency].every(value => value?.toUpperCase() === order.currency.toUpperCase())
    // Stripe documents that a disputed amount can differ from the charge,
    // including FX fluctuations. Charge/intent binding—not equality here—
    // identifies the purchase that must be held.
    && Number.isSafeInteger(dispute.amount) && dispute.amount > 0 && dispute.amount <= 2_147_483_647;
}
function createStripeDisputeService({ sequelize, models, stripe, ledger, now = () => new Date() }) {
  async function reconcileDisputeEvent(event, account) {
    if (!stripe?.enabled || stripe.mode !== 'test') throw new DomainError('Sandbox dispute reconciliation unavailable', {code:'STRIPE_DISPUTE_SYNC_UNAVAILABLE',status:503});
    const reference = event.data?.object?.id;
    if (!/^du_[A-Za-z0-9]+$/.test(reference || '') || event.account !== account.stripeAccountId || event.livemode !== false) throw conflict('Dispute selection needs review','DISPUTE_VERIFICATION_FAILED');
    // The signed payload selects an object, never a financial status. Find its
    // immutable original merchant/order before beginning a fresh observation.
    let selected;
    try { selected = await stripe.retrieveDispute(reference,{stripeAccount:account.stripeAccountId}); }
    catch { return {retryable:true}; }
    if (selected?.id !== reference || selected.livemode !== false) throw conflict('Dispute reference needs review','DISPUTE_VERIFICATION_FAILED');
    const order = await models.Order.findOne({where:{stripeChargeId:providerId(selected.charge),stripeAccountId:account.stripeAccountId,paymentAccountId:account.id,providerMode:'test'}});
    if (!order) return {ignored:true};
    const token = randomUUID();
    const claim = await mutationTransaction(sequelize,async transaction => {
      await models.Event.findByPk(order.eventId,{transaction,lock:transaction.LOCK.UPDATE});
      const lockedOrder = await models.Order.findByPk(order.id,{transaction,lock:transaction.LOCK.UPDATE});
      const [row] = await models.PurchaseDispute.findOrCreate({where:{stripeAccountId:account.stripeAccountId,providerMode:'test',stripeDisputeId:reference},
        defaults:{orderId:order.id,currency:order.currency},transaction});
      await row.reload({transaction,lock:transaction.LOCK.UPDATE});
      if (row.orderId !== order.id || !lockedOrder.paidAt || !['paid','refunded'].includes(lockedOrder.status)) throw conflict('Dispute order needs review','DISPUTE_VERIFICATION_FAILED');
      // Terminal provider resolution cannot regress through a delayed webhook.
      if (CLOSED.has(row.status)) return {terminal:true};
      await row.update({observationToken:token},{transaction});
      return {id:row.id};
    });
    if (claim.terminal) return {replayed:true};
    let dispute,charge,intent;
    try {
      // Provider IO is outside all event/earning locks. Re-fetch after the
      // observation fence so an old success cannot overwrite newer loss.
      dispute = await stripe.retrieveDispute(reference,{stripeAccount:order.stripeAccountId});
      [charge,intent] = await Promise.all([
        stripe.retrieveCharge(order.stripeChargeId,{stripeAccount:order.stripeAccountId}),
        stripe.retrievePaymentIntent(order.stripePaymentIntentId,{stripeAccount:order.stripeAccountId}),
      ]);
    } catch { return {retryable:true}; }
    if (dispute?.id !== reference || !verifyDispute(order,dispute,charge,intent)) throw conflict('Dispute payment binding needs review','DISPUTE_VERIFICATION_FAILED');
    return mutationTransaction(sequelize,async transaction => {
      await models.Event.findByPk(order.eventId,{transaction,lock:transaction.LOCK.UPDATE});
      await models.Order.findByPk(order.id,{transaction,lock:transaction.LOCK.UPDATE});
      const row = await models.PurchaseDispute.findByPk(claim.id,{transaction,lock:transaction.LOCK.UPDATE});
      if (row.observationToken !== token || CLOSED.has(row.status)) return {retryable:!CLOSED.has(row.status),superseded:true};
      await row.update({status:dispute.status,amountCents:dispute.amount,synchronizedAt:now()},{transaction});
      const hold = await models.PurchaseDispute.count({where:{orderId:order.id,status:{[Op.in]:HELD}},transaction}) > 0;
      await ledger.setDisputeHold({orderId:order.id,hold,transaction});
      await models.AuditLog.create({organizationId:order.commissionSnapshot?.organizationId || (await models.Event.findByPk(order.eventId,{transaction})).organizationId,
        entityType:'Order',entityId:order.id,action:'order.dispute_verified',after:{stripeDisputeId:reference,status:dispute.status,amountCents:dispute.amount,commissionHeld:hold}}, {transaction});
      // A lost dispute is a held liability for finance review, not an invented
      // customer refund or a silent clawback of an already-paid commission.
      return {orderId:order.id,status:row.status,commissionHeld:hold};
    });
  }
  return {reconcileDisputeEvent};
}
module.exports = {createStripeDisputeService,verifyDispute};
