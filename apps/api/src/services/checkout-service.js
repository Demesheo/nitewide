const { calculatePricing } = require('../domain/pricing');
const { fulfillCheckout } = require('./checkout-fulfillment');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');
const { eventFinished, offeringSaleState } = require('../domain/event-policy');
const { createNotificationJobService } = require('./notification-job-service');
const { assertActiveUser, assertActiveEvent } = require('./lifecycle-service');
const { createHash } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { mutationTransaction } = require('./mutation-transaction');
const { effectiveFeeMode } = require('@nitewide/pricing');
const { commissionSnapshot } = require('../domain/commission-policy');

function canonicalCart(eventId, items) {
  if (!Array.isArray(items) || !items.length) throw new DomainError('At least one item is required', { code: 'EMPTY_ORDER' });
  const quantities = new Map();
  for (const item of items) {
    if (!item.offeringId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new DomainError('Each item needs an offering and positive whole quantity', { code: 'INVALID_QUANTITY' });
    const quantity = (quantities.get(item.offeringId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new DomainError('Invalid quantity', { code: 'INVALID_QUANTITY' });
    quantities.set(item.offeringId, quantity);
  }
  return JSON.stringify({ eventId, items: [...quantities].sort(([a], [b]) => a.localeCompare(b)) });
}
const fingerprint = (input) => createHash('sha256').update(JSON.stringify({ cart: canonicalCart(input.eventId, input.items), affiliateCode: input.affiliateCode || null })).digest('hex');

function createCheckoutService({ sequelize, models, now = () => new Date(), environment = process.env.NODE_ENV || 'development', hostedDemo = false, email = null, customerAppUrl = 'http://localhost:5173', notificationJobs = createNotificationJobService({ sequelize, models, now }) }) {
  return async function checkout(input) {
    if (hostedDemo && input.payment && input.payment.provider !== 'demo') throw new DomainError('Only mock payments are available in the hosted demo', { code: 'DEMO_ONLY' });
    const requestFingerprint = fingerprint(input);
    return mutationTransaction(sequelize, async (transaction) => {
      // Serialize only this buyer/key, not their other checkouts. Covers concurrent
      // reuse against different events, where an event row lock alone cannot.
      if (typeof sequelize.query === 'function') await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
        replacements: { key: `checkout/${input.buyerUserId}/${input.idempotencyKey}` }, transaction, type: QueryTypes.SELECT,
      });
      assertActiveUser(await models.User.findByPk(input.buyerUserId, { transaction, lock: transaction.LOCK.SHARE || 'SHARE' }));
      const existing = await models.Order.findOne({ where: { buyerUserId: input.buyerUserId, idempotencyKey: input.idempotencyKey }, include: [{ model: models.OrderItem, as: 'items' }], transaction });
      if (existing) {
        const matches = existing.requestFingerprint ? existing.requestFingerprint === requestFingerprint
          : Boolean(existing.items?.length) && canonicalCart(existing.eventId, existing.items.map((item) => ({ offeringId: item.offeringId, quantity: item.quantity }))) === canonicalCart(input.eventId, input.items);
        if (!matches) throw conflict('This checkout key was already used for a different cart or referral. Use a new key for a new purchase.', 'IDEMPOTENCY_CONFLICT');
        return { order: existing, credentials: [], replayed: true };
      }
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      await assertActiveEvent(models, event, transaction);
      const organization = event.organizationId ? await models.Organization.findByPk(event.organizationId, { transaction }) : null;
      const current = now();
      if (event.status !== 'published' || eventFinished(event, current)) throw new DomainError('Event is not on sale', { code: 'EVENT_NOT_ON_SALE' });
      if (!Array.isArray(input.items) || !input.items.length) throw new DomainError('At least one item is required', { code: 'EMPTY_ORDER' });

      const normalized = new Map();
      for (const item of input.items) normalized.set(item.offeringId, (normalized.get(item.offeringId) || 0) + item.quantity);
      const offeringIds = [...normalized.keys()];
      const offerings = await models.Offering.findAll({ where: { id: offeringIds, eventId: event.id }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      const prerequisites = offerings.some((o) => o.releaseAfterOfferingId)
        ? await models.Offering.findAll({ where: { eventId: event.id }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE }) : offerings;
      if (offerings.length !== offeringIds.length) throw notFound('Offering');
      if (new Set(offerings.map((offering) => offering.currency)).size !== 1) throw new DomainError('All order items must use the same currency', { code: 'MIXED_CURRENCY' });
      let subtotalCents = 0;
      const lines = [];
      for (const offering of offerings) {
        const quantity = normalized.get(offering.id);
        if (!Number.isInteger(quantity) || quantity < offering.minPerOrder || quantity > offering.maxPerOrder) throw new DomainError(`Invalid quantity for ${offering.name}`, { code: 'INVALID_QUANTITY' });
        const saleState = offeringSaleState(offering, prerequisites, current);
        if (!['on_sale', 'sold_out'].includes(saleState)) throw new DomainError(`${offering.name} is not currently available`, { code: 'OFFERING_NOT_ON_SALE' });
        if (offering.inventoryMode === 'finite' && offering.quantitySold + (offering.quantityReserved || 0) + quantity > offering.quantityTotal) throw conflict(`${offering.name} does not have enough inventory`, 'INSUFFICIENT_INVENTORY');
        subtotalCents += offering.priceCents * quantity;
        lines.push({ offering, quantity, lineTotalCents: offering.priceCents * quantity });
      }
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: current, transaction, lock: transaction.LOCK.UPDATE });
      if (affiliate.eventAffiliate?.userId === input.buyerUserId || affiliate.orgAffiliate?.userId === input.buyerUserId) throw new DomainError('Self-referrals do not earn commission', { code: 'SELF_REFERRAL' });
      const commission = commissionSnapshot({ event, organization, affiliate, subtotalCents, currency: offerings[0].currency, now: current });
      const pricing = calculatePricing({ subtotalCents, items: lines.map(({ offering, quantity }) => ({ unitPriceCents: offering.priceCents, quantity,
        feeMode: effectiveFeeMode(event.feeMode || 'buyer',offering.feeMode || 'inherit') })), currency: offerings[0].currency, now: current, planTier: organization?.planTier || 'free', commissionBps: commission.effectiveCommissionBps });
      if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== pricing.totalCents)
        throw conflict('Pricing changed. Review the updated total before confirming.', 'PRICE_CHANGED');
      const demo = hostedDemo || input.payment?.provider === 'demo';
      if (demo && !hostedDemo && !['development', 'test'].includes(environment)) throw new DomainError('Demo checkout is disabled in this environment', { code: 'DEMO_DISABLED' });
      // A browser claim is never proof of a provider charge. Real paid sales stay
      // closed until server verification, durable webhooks and refunds are ready.
      if (pricing.totalCents > 0 && !demo) throw new DomainError('Paid checkout is unavailable until secure payment processing is enabled', { code: 'PAYMENTS_NOT_ENABLED', status: 503 });
      const isPaid = pricing.totalCents > 0 && demo && input.payment?.status === 'succeeded';
      if (pricing.totalCents > 0 && !isPaid) throw new DomainError('Successful payment confirmation is required', { code: 'PAYMENT_REQUIRED', status: 402 });
      const order = await models.Order.create({
        buyerUserId: input.buyerUserId, eventId: event.id, status: 'paid', currency: offerings[0].currency,
        subtotalCents, ...pricing, commissionSnapshot: commission, pricingPlanSnapshot: { ...pricing.pricingPlanSnapshot, commissionBps: commission.effectiveCommissionBps,
          configuredCommissionBps: affiliate.configuredCommissionBps, commissionEligibility: affiliate.commissionEligibility, demo }, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id,
        idempotencyKey: input.idempotencyKey, requestFingerprint, paidAt: current,
      }, { transaction });
      const credentials = await fulfillCheckout({ models, order, event, lines, affiliate, demo,
        provider: pricing.totalCents === 0 ? 'free' : 'demo',
        providerReference: pricing.totalCents === 0 ? `free-${order.id}` : input.payment?.reference || `demo-${order.id}`,
        current, transaction, email, customerAppUrl, notificationJobs });
      return { order, credentials, replayed: false };
    });
  };
}
module.exports = { createCheckoutService, canonicalCart, fingerprint };
