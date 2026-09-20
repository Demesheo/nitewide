function createCommerceController({ checkout, requestGuestlist, reviewGuestlist, checkIn, permissions, models }) {
  return {
    checkout: async (req, res) => { const result = await checkout({ ...req.body, buyerUserId: req.userId }); res.status(result.replayed ? 200 : 201).json({ data: result }); },
    getOrder: async (req, res) => { const order = await models.Order.findOne({ where: { id: req.params.orderId, buyerUserId: req.userId }, include: [{ model: models.OrderItem, as: 'items', include: [{ model: models.Ticket, as: 'tickets', attributes: { exclude: ['qrTokenHash'] } }] }] }); if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }); res.json({ data: order }); },
    requestGuestlist: async (req, res) => { const result = await requestGuestlist({ ...req.body, eventId: req.params.eventId, userId: req.userId }); res.status(202).json({ data: result }); },
    listGuestlistRequests: async (req, res) => {
      await permissions.assertGuestlistApprover(req.userId, req.params.eventId);
      const status = req.query.status || 'pending';
      const entries = await models.GuestlistEntry.findAll({
        where: { eventId: req.params.eventId, status },
        include: [{ model: models.User, as: 'user', attributes: ['id', 'displayName', 'email'] }, { model: models.EventAffiliate, as: 'eventAffiliate', attributes: ['id', 'code', 'userId'] }],
        order: [['createdAt', 'ASC']],
      });
      res.json({ data: entries });
    },
    reviewGuestlist: async (req, res) => {
      await permissions.assertGuestlistApprover(req.userId, req.params.eventId);
      const result = await reviewGuestlist({ ...req.body, eventId: req.params.eventId, entryId: req.params.entryId, reviewedByUserId: req.userId });
      res.json({ data: result });
    },
    checkIn: async (req, res) => { await permissions.assertManageEvent(req.userId, req.body.eventId); const result = await checkIn({ ...req.body, checkedInByUserId: req.userId }); res.status(201).json({ data: result }); },
  };
}
module.exports = { createCommerceController };
