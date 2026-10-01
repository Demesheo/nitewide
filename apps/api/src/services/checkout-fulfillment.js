const { createQrToken } = require('../domain/qr');
const { queuePurchaseEmail } = require('./email-events');

// Caller owns the event, order and offering row locks. Both synchronous free/demo
// sales and independently verified provider sales share this atomic finalizer.
async function fulfillCheckout({ models, order, event, lines, affiliate = {}, demo = false, provider, providerReference,
  reserved = false, current, transaction, email, customerAppUrl, notificationJobs }) {
  const soldOutOfferings = lines.filter(({ offering, quantity }) => offering.inventoryMode === 'finite' && offering.quantitySold + quantity === offering.quantityTotal).map(({ offering }) => ({ id: offering.id, name: offering.name }));
  const credentials = [];
  for (const line of lines) {
    const item = line.item || await models.OrderItem.create({ orderId: order.id, offeringId: line.offering.id,
      nameSnapshot: line.offering.name, kindSnapshot: line.offering.kind, quantity: line.quantity,
      entriesPerUnitSnapshot: line.offering.entriesPerUnit, unitPriceCents: line.offering.priceCents,
      lineTotalCents: line.lineTotalCents }, { transaction });
    if (reserved) await line.offering.increment('quantityReserved', { by: -line.quantity, transaction });
    await line.offering.increment('quantitySold', { by: line.quantity, transaction });
    for (let index = 0; index < line.quantity * item.entriesPerUnitSnapshot; index += 1) {
      const qr = createQrToken();
      const ticket = await models.Ticket.create({ eventId: event.id, orderItemId: item.id, holderUserId: order.buyerUserId, qrTokenHash: qr.hash }, { transaction });
      credentials.push({ ticketId: ticket.id, qrToken: qr.token });
    }
  }
  await models.Payment.create({ orderId: order.id, provider, providerReference, status: 'succeeded', amountCents: order.totalCents, currency: order.currency, processedAt: current,
    metadata: provider === 'stripe' ? { stripeAccountId: order.stripeAccountId, checkoutSessionId: order.checkoutSessionId, applicationFeeCents: order.applicationFeeCents } : undefined }, { transaction });
  await models.AffiliateAttribution.create({ eventId: event.id, userId: order.buyerUserId, orgAffiliateId: order.orgAffiliateId, eventAffiliateId: order.eventAffiliateId, action: 'purchase', orderId: order.id, occurredAt: current }, { transaction });
  await models.AuditLog.create({ actorUserId: order.buyerUserId, organizationId: event.organizationId, entityType: 'Order', entityId: order.id, action: demo ? 'order.demo' : 'order.paid', after: { totalCents: order.totalCents, demo, provider } }, { transaction });
  const snapshotLines = lines.map((line) => ({ ...line, offering: { ...line.offering, name: line.item?.nameSnapshot || line.offering.name } }));
  await queuePurchaseEmail({ email, models, order, event, lines: snapshotLines, demo, buyerUserId: order.buyerUserId, customerAppUrl, transaction });
  await notificationJobs.enqueueCheckout({ orderId: order.id, eventId: event.id, eventTitle: event.title,
    buyerUserId: order.buyerUserId, referrerUserId: affiliate.eventAffiliate?.userId || affiliate.orgAffiliate?.userId || null,
    eventAffiliateId: order.eventAffiliateId || null, orgAffiliateId: order.orgAffiliateId || null,
    names: snapshotLines.map(({ offering, quantity }) => `${quantity} × ${offering.name}`).join(', '),
    subtotalCents: order.subtotalCents, commissionCents: order.affiliateCommissionCents || 0, demo, soldOutOfferings }, transaction);
  return credentials;
}
module.exports = { fulfillCheckout };
