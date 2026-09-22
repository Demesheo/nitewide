const { Transaction } = require('sequelize');
const { calculatePricing } = require('../domain/pricing');
const { createQrToken } = require('../domain/qr');
const { DomainError, notFound, conflict } = require('../domain/errors');
const { resolveAffiliate } = require('./affiliate-service');
const { eventFinished, offeringSaleState } = require('../domain/event-policy');

function createCheckoutService({ sequelize, models, now = () => new Date() }) {
  return async function checkout(input) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (transaction) => {
      const existing = await models.Order.findOne({ where: { buyerUserId: input.buyerUserId, idempotencyKey: input.idempotencyKey }, include: [{ model: models.OrderItem, as: 'items' }], transaction });
      if (existing) return { order: existing, credentials: [], replayed: true };
      const event = await models.Event.findByPk(input.eventId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!event) throw notFound('Event');
      const organization = event.organizationId ? await models.Organization.findByPk(event.organizationId, { transaction }) : null;
      const current = now();
      if (event.status !== 'published' || eventFinished(event, current)) throw new DomainError('Event is not on sale', { code: 'EVENT_NOT_ON_SALE' });
      if (!Array.isArray(input.items) || !input.items.length) throw new DomainError('At least one item is required', { code: 'EMPTY_ORDER' });

      const normalized = new Map();
      for (const item of input.items) normalized.set(item.offeringId, (normalized.get(item.offeringId) || 0) + item.quantity);
      const offeringIds = [...normalized.keys()];
      const offerings = await models.Offering.findAll({ where: { id: offeringIds, eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE });
      const prerequisites = offerings.some((o) => o.releaseAfterOfferingId)
        ? await models.Offering.findAll({ where: { eventId: event.id }, transaction, lock: transaction.LOCK.UPDATE }) : offerings;
      if (offerings.length !== offeringIds.length) throw notFound('Offering');
      if (new Set(offerings.map((offering) => offering.currency)).size !== 1) throw new DomainError('All order items must use the same currency', { code: 'MIXED_CURRENCY' });
      let subtotalCents = 0;
      const lines = [];
      for (const offering of offerings) {
        const quantity = normalized.get(offering.id);
        if (!Number.isInteger(quantity) || quantity < offering.minPerOrder || quantity > offering.maxPerOrder) throw new DomainError(`Invalid quantity for ${offering.name}`, { code: 'INVALID_QUANTITY' });
        const saleState = offeringSaleState(offering, prerequisites, current);
        if (!['on_sale', 'sold_out'].includes(saleState)) throw new DomainError(`${offering.name} is not currently available`, { code: 'OFFERING_NOT_ON_SALE' });
        if (offering.inventoryMode === 'finite' && offering.quantitySold + quantity > offering.quantityTotal) throw conflict(`${offering.name} does not have enough inventory`, 'INSUFFICIENT_INVENTORY');
        subtotalCents += offering.priceCents * quantity;
        lines.push({ offering, quantity, lineTotalCents: offering.priceCents * quantity });
      }
      const affiliate = await resolveAffiliate(models, { event, code: input.affiliateCode, now: current, transaction, lock: transaction.LOCK.UPDATE });
      if (affiliate.eventAffiliate?.userId === input.buyerUserId || affiliate.orgAffiliate?.userId === input.buyerUserId) throw new DomainError('Self-referrals do not earn commission', { code: 'SELF_REFERRAL' });
      const pricing = calculatePricing({ subtotalCents, planTier: organization?.planTier || 'free', commissionBps: affiliate.commissionBps });
      const isPaid = pricing.totalCents > 0 && input.payment?.status === 'succeeded';
      if (pricing.totalCents > 0 && !isPaid) throw new DomainError('Successful payment confirmation is required', { code: 'PAYMENT_REQUIRED', status: 402 });
      const order = await models.Order.create({
        buyerUserId: input.buyerUserId, eventId: event.id, status: 'paid', currency: offerings[0].currency,
        subtotalCents, ...pricing, pricingPlanSnapshot: { ...pricing.pricingPlanSnapshot, commissionBps: affiliate.commissionBps }, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id,
        idempotencyKey: input.idempotencyKey, paidAt: current,
      }, { transaction });
      const credentials = [];
      for (const line of lines) {
        const item = await models.OrderItem.create({ orderId: order.id, offeringId: line.offering.id, nameSnapshot: line.offering.name, kindSnapshot: line.offering.kind, quantity: line.quantity, entriesPerUnitSnapshot: line.offering.entriesPerUnit, unitPriceCents: line.offering.priceCents, lineTotalCents: line.lineTotalCents }, { transaction });
        await line.offering.increment('quantitySold', { by: line.quantity, transaction });
        const count = line.quantity * line.offering.entriesPerUnit;
        for (let index = 0; index < count; index += 1) {
          const qr = createQrToken();
          const ticket = await models.Ticket.create({ eventId: event.id, orderItemId: item.id, holderUserId: input.buyerUserId, qrTokenHash: qr.hash }, { transaction });
          credentials.push({ ticketId: ticket.id, qrToken: qr.token });
        }
      }
      await models.Payment.create({ orderId: order.id, provider: input.payment?.provider || 'free', providerReference: input.payment?.reference || `free-${order.id}`, status: 'succeeded', amountCents: pricing.totalCents, currency: offerings[0].currency, processedAt: current }, { transaction });
      await models.AffiliateAttribution.create({ eventId: event.id, userId: input.buyerUserId, orgAffiliateId: affiliate.orgAffiliate?.id, eventAffiliateId: affiliate.eventAffiliate?.id, action: 'purchase', orderId: order.id, occurredAt: current }, { transaction });
      await models.AuditLog.create({ actorUserId: input.buyerUserId, organizationId: event.organizationId, entityType: 'Order', entityId: order.id, action: 'order.paid', after: { totalCents: pricing.totalCents } }, { transaction });
      return { order, credentials, replayed: false };
    });
  };
}
module.exports = { createCheckoutService };
