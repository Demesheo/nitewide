function createCommerceController({ checkout, joinGuestlist, checkIn, permissions, models }) {
  return {
    checkout: async (req, res) => { const result = await checkout({ ...req.body, buyerUserId: req.userId }); res.status(result.replayed ? 200 : 201).json({ data: result }); },
    getOrder: async (req, res) => { const order = await models.Order.findOne({ where: { id: req.params.orderId, buyerUserId: req.userId }, include: [{ model: models.OrderItem, as: 'items', include: [{ model: models.Ticket, as: 'tickets', attributes: { exclude: ['qrTokenHash'] } }] }] }); if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }); res.json({ data: order }); },
    joinGuestlist: async (req, res) => { const result = await joinGuestlist({ ...req.body, eventId: req.params.eventId, userId: req.userId }); res.status(201).json({ data: result }); },
    checkIn: async (req, res) => { await permissions.assertManageEvent(req.userId, req.body.eventId); const result = await checkIn({ ...req.body, checkedInByUserId: req.userId }); res.status(201).json({ data: result }); },
  };
}
module.exports = { createCommerceController };

