// Operational updates share one audience across email and in-app delivery.
// Deduplicate accounts with multiple purchases or both a purchase and guestlist.
async function audienceForEvent(models, eventId, transaction) {
  const orders = await models.Order.findAll({ where: { eventId, status: 'paid' }, attributes: ['id', 'buyerUserId'], transaction });
  const entries = await models.GuestlistEntry.findAll({ where: { eventId, status: ['pending', 'confirmed', 'checked_in'] }, attributes: ['id', 'userId'], transaction });
  const userIds = [...new Set([...orders.map((row) => row.buyerUserId), ...entries.map((row) => row.userId)].filter(Boolean))];
  if (!userIds.length) return [];
  const users = await models.User.findAll({ where: { id: userIds, isActive: true }, attributes: ['id', 'email', 'displayName'], transaction });
  return users.map((user) => {
    const order = orders.find((row) => row.buyerUserId === user.id);
    const entry = entries.find((row) => row.userId === user.id);
    return { user, booking: order ? { kind: 'purchase', id: order.id } : { kind: 'guestlist', id: entry.id } };
  });
}

module.exports = { audienceForEvent };
