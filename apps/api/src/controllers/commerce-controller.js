const { Op } = require('sequelize');
const { guestlistQuery } = require('../http/schemas');
const { forbidden } = require('../domain/errors');

function customerOrder(order) {
  const data = order.toJSON ? order.toJSON() : { ...order };
  const { tier, monthlyFeeCents, percentageBps, perPaidUnitCents, processingPaidBy, version, demo } = data.pricingPlanSnapshot || {};
  return { ...data, pricingPlanSnapshot: { tier, monthlyFeeCents, percentageBps, perPaidUnitCents, processingPaidBy, version, demo } };
}
function createCommerceController({ checkout, requestGuestlist, reviewGuestlist, checkIn, permissions, models }) {
  return {
    checkout: async (req, res) => { const result = await checkout({ ...req.body, buyerUserId: req.userId }); res.status(result.replayed ? 200 : 201).json({ data: { ...result, order: customerOrder(result.order) } }); },
    getOrder: async (req, res) => { const order = await models.Order.findOne({ where: { id: req.params.orderId, buyerUserId: req.userId }, include: [{ model: models.OrderItem, as: 'items', include: [{ model: models.Ticket, as: 'tickets', attributes: { exclude: ['qrTokenHash'] } }] }] }); if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }); res.json({ data: customerOrder(order) }); },
    requestGuestlist: async (req, res) => { const result = await requestGuestlist({ ...req.body, eventId: req.params.eventId, userId: req.userId }); res.status(202).json({ data: result }); },
    listGuestlistRequests: async (req, res) => {
      const scope = await permissions.guestlistReviewScope(req.userId, req.params.eventId);
      const { status } = guestlistQuery.parse(req.query);
      const where = { eventId: req.params.eventId };
      if (status !== 'all') where.status = { [Op.in]: Array.isArray(status) ? status : [status] };
      if (!scope.canReviewAny) where.eventAffiliateId = { [Op.in]: scope.eventAffiliateIds };
      const entries = await models.GuestlistEntry.findAll({
        where,
        attributes: { exclude: ['qrTokenHash'] },
        include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email', 'phone'] },
          { model: models.EventAffiliate, as: 'eventAffiliate', attributes: ['id', 'code', 'userId'], include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName'] }] },
          { model: models.User, as: 'reviewer', attributes: ['id', 'displayName'] }],
        order: [['createdAt', 'ASC']],
      });
      res.json({ data: entries });
    },
    reviewGuestlist: async (req, res) => {
      const scope = await permissions.guestlistReviewScope(req.userId, req.params.eventId);
      if (!scope.canReviewAny) {
        const ownEntry = await models.GuestlistEntry.findOne({ where: { id: req.params.entryId, eventId: req.params.eventId, eventAffiliateId: { [Op.in]: scope.eventAffiliateIds } }, attributes: ['id'] });
        if (!ownEntry) throw forbidden('You can only review guestlist requests referred by you');
      }
      const result = await reviewGuestlist({ ...req.body, eventId: req.params.eventId, entryId: req.params.entryId, reviewedByUserId: req.userId });
      res.json({ data: result });
    },
    checkIn: async (req, res) => { await permissions.assertManageEvent(req.userId, req.body.eventId); const result = await checkIn({ ...req.body, checkedInByUserId: req.userId }); res.status(201).json({ data: result }); },
  };
}
module.exports = { createCommerceController, customerOrder };
