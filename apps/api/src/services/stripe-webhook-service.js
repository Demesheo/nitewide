const { DomainError, notFound } = require('../domain/errors');
const { mutationTransaction } = require('./mutation-transaction');

function createStripeWebhookService({ sequelize, models, stripe, paymentCheckouts, paymentAccounts, refunds, now = () => new Date() }) {
  async function invalidateAccount(account, eventId) {
    await mutationTransaction(sequelize, async (transaction) => {
      const locked = await models.PaymentAccount.findByPk(account.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked.lifecycleState === 'archived' && !locked.chargesEnabled) return;
      await locked.update({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, cardPaymentsActive: false,
        controllerMatches: false, lifecycleState: 'archived', synchronizedAt: now(),paymentsDisabledAt:locked.paymentsDisabledAt || now(),
        disconnectStatus:'disconnected',disconnectedAt:now(),disconnectErrorCode:null }, { transaction });
      await models.AuditLog.create({ organizationId: locked.organizationId, entityType: 'PaymentAccount', entityId: locked.id,
        action: 'payment_account.deauthorized', after: { stripeAccountId: locked.stripeAccountId, stripeEventId: eventId } }, { transaction });
    }, { accessChange: true });
  }
  async function receive(rawBody, signature) {
    if (!stripe?.enabled || stripe.mode !== 'test') throw new DomainError('Stripe webhooks unavailable', { code: 'STRIPE_WEBHOOK_UNAVAILABLE', status: 503 });
    let event;
    try { event = stripe.constructWebhookEvent(rawBody, signature); } catch { throw new DomainError('Invalid Stripe signature', { code: 'INVALID_WEBHOOK', status: 400 }); }
    if (event.livemode !== false || !event.account || !event.id) throw new DomainError('Only connected sandbox events are accepted', { code: 'INVALID_WEBHOOK', status: 400 });
    const account = await models.PaymentAccount.findOne({ where: { stripeAccountId: event.account, mode: 'test' } });
    if (!account) return { received: true, ignored: true };
    const [receipt] = await models.StripeWebhookReceipt.findOrCreate({ where: { stripeEventId: event.id, stripeAccountId: event.account, mode: 'test' }, defaults: { type: event.type, status: 'pending' } });
    if (receipt.stripeAccountId !== event.account || receipt.mode !== 'test') throw new DomainError('Webhook account mismatch', { code: 'INVALID_WEBHOOK', status: 400 });
    if (receipt.status === 'processed') return { received: true, replayed: true };
    // Payload status never fulfills an order. The signed event only identifies
    // which immutable provider object to independently retrieve and verify.
    if (event.type.startsWith('checkout.session.')) {
      const session = await stripe.retrieveCheckoutSession(event.data.object.id, { stripeAccount: account.stripeAccountId, expand: ['payment_intent.latest_charge'] });
      const orderId = session.metadata?.orderId;
      const order = orderId && await models.Order.findOne({ where: { id: orderId, paymentAccountId: account.id, stripeAccountId: account.stripeAccountId, providerMode: 'test' } });
      if (!order || session.livemode !== false || session.client_reference_id !== order.id
        || session.amount_total !== order.totalCents || session.currency?.toUpperCase() !== order.currency.toUpperCase()) throw new DomainError('Unknown or mismatched checkout', { code: 'INVALID_WEBHOOK', status: 400 });
      // A completion may arrive before our creation response is saved. Recover
      // OUR original provider idempotency key; matching metadata alone cannot
      // attach a merchant-created lookalike Session to this buyer's order.
      if (!order.checkoutSessionId) {
        const recovered = await paymentCheckouts.reconcileOrder(order);
        if (recovered.retryable) throw new DomainError('Payment reconciliation is pending', { code: 'STRIPE_RECONCILIATION_PENDING', status: 503 });
      }
      const boundOrder = await models.Order.findByPk(order.id);
      if (boundOrder.checkoutSessionId !== session.id) throw new DomainError('Session mismatch', { code: 'INVALID_WEBHOOK', status: 400 });
      const result = await paymentCheckouts.reconcileOrder(boundOrder);
      if (result.retryable) throw new DomainError('Payment reconciliation is pending', { code: 'STRIPE_RECONCILIATION_PENDING', status: 503 });
    } else if (event.type === 'account.application.deauthorized') {
      // Access has already been revoked: retrieval may be impossible. Signed
      // deauthorization is negative evidence, never readiness or payment proof.
      await invalidateAccount(account, event.id);
    } else if (event.type === 'account.updated') {
      if (account.lifecycleState !== 'archived') {
        if (paymentAccounts?.synchronizeTrusted) await paymentAccounts.synchronizeTrusted(account.stripeAccountId);
        else if (paymentAccounts?.synchronize) await paymentAccounts.synchronize(account.id);
        else if (paymentAccounts?.refreshAccount) await paymentAccounts.refreshAccount(account.id);
        else throw new DomainError('Account synchronization unavailable', { code: 'STRIPE_ACCOUNT_SYNC_UNAVAILABLE', status: 503 });
      }
    } else if (event.type.startsWith('refund.') || event.type === 'charge.refunded') {
      // Refund reconciliation is separately authenticated and provider-bound.
      // Root injects the service here once configured; unhandled evidence stays
      // retryable rather than falsely acknowledged as processed.
      if (!refunds?.reconcileRefundEvent) throw new DomainError('Refund reconciliation unavailable', { code: 'STRIPE_REFUND_SYNC_UNAVAILABLE', status: 503 });
      const result = await refunds.reconcileRefundEvent(event, account);
      if (result?.retryable) throw new DomainError('Refund reconciliation is pending', { code: 'STRIPE_RECONCILIATION_PENDING', status: 503 });
    }
    await receipt.update({ status: 'processed', processedAt: now() });
    return { received: true, replayed: false };
  }
  async function receiveAccountNotification(rawBody, signature) {
    if (!stripe?.enabled || stripe.mode !== 'test') throw new DomainError('Stripe account notifications unavailable', { code: 'STRIPE_WEBHOOK_UNAVAILABLE', status: 503 });
    let notification;
    try { notification = stripe.constructAccountNotification(rawBody, signature); } catch { throw new DomainError('Invalid Stripe account signature', { code: 'INVALID_WEBHOOK', status: 400 }); }
    if (!notification?.id) throw new DomainError('Invalid Stripe account notification', { code: 'INVALID_WEBHOOK', status: 400 });
    const event = await stripe.retrieveAccountNotification(notification.id);
    const types = new Set(['v2.core.account.updated', 'v2.core.account.closed', 'v2.core.account[configuration.merchant].updated',
      'v2.core.account[configuration.merchant].capability_status_updated', 'v2.core.account[requirements].updated', 'v2.core.account[defaults].updated']);
    if (event.id !== notification.id || event.object !== 'v2.core.event' || event.livemode !== false || !types.has(event.type)
      || !/^acct_[A-Za-z0-9]+$/.test(event.related_object?.id || '') || event.related_object?.type !== 'v2.core.account') {
      throw new DomainError('Invalid retrieved sandbox account event', { code: 'INVALID_WEBHOOK', status: 400 });
    }
    const account = await models.PaymentAccount.findOne({ where: { stripeAccountId: event.related_object.id, mode: 'test' } });
    if (!account) return { received: true, ignored: true };
    const [receipt] = await models.StripeWebhookReceipt.findOrCreate({ where: { stripeEventId: event.id, stripeAccountId: account.stripeAccountId, mode: 'test' }, defaults: { type: event.type, status: 'pending' } });
    if (receipt.status === 'processed') return { received: true, replayed: true };
    if (event.type === 'v2.core.account.closed') await invalidateAccount(account, event.id);
    else if (account.lifecycleState !== 'archived') await paymentAccounts.synchronizeTrusted(account.stripeAccountId);
    await receipt.update({ status: 'processed', processedAt: now() });
    return { received: true, replayed: false };
  }
  return { receive, receiveAccountNotification };
}
module.exports = { createStripeWebhookService };
