const { Op } = require('sequelize');
const { notFound } = require('../domain/errors');

function createNotificationService(models) {
  async function emit({ userId, eventId = null, kind, title, message, metadata = {} }, transaction) {
    if (!userId) return null;
    // Delivery adapters belong behind an outbox worker. Do not email or text
    // until addresses/numbers, consent, idempotency and retries are verified.
    return models.Notification.create({ userId, eventId, kind, title, message, metadata }, { transaction });
  }
  async function list(userId) {
    return models.Notification.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit: 50 });
  }
  async function unreadCount(userId) {
    return models.Notification.count({ where: { userId, readAt: { [Op.is]: null } } });
  }
  async function markRead(userId, id) {
    const notification = await models.Notification.findOne({ where: { id, userId } });
    if (!notification) throw notFound('Notification');
    if (!notification.readAt) await notification.update({ readAt: new Date() });
    return notification;
  }
  return { emit, list, unreadCount, markRead };
}
module.exports = { createNotificationService };
