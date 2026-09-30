const { Op } = require('sequelize');
const { notFound } = require('../domain/errors');

function createNotificationService(models) {
  async function emit({ userId, eventId = null, kind, title, message, metadata = {} }, transaction) {
    if (!userId) return null;
    const optionalSetting = { guestlist_request: 'reviewRequests', referral_purchase: 'salesActivity',
      event_purchase: 'salesActivity', offering_sold_out: 'inventoryAlerts' }[kind];
    if (optionalSetting) {
      const recipient = await models.User.findByPk(userId, { attributes: ['notificationPreferences'], transaction });
      if (recipient?.notificationPreferences?.[optionalSetting] === false) return null;
    }
    // Delivery adapters belong behind an outbox worker. Do not email or text
    // until addresses/numbers, consent, idempotency and retries are verified.
    return models.Notification.create({ userId, eventId, kind, title, message, metadata }, { transaction });
  }
  async function enrichLegacy(userId, rows) {
    // Older invitation notifications predate entryId metadata. Resolve only this
    // recipient's entry, without reseeding or guessing from another customer's data.
    const legacy = rows.filter(row => ['guestlist_invited', 'guestlist_approved', 'guestlist_declined'].includes(row.kind) && !row.metadata?.entryId && row.eventId);
    if (!legacy.length) return rows;
    const entries = await models.GuestlistEntry.findAll({ where: { userId, eventId: { [Op.in]: [...new Set(legacy.map(row => row.eventId))] } }, attributes: ['id', 'eventId'] });
    const byEvent = new Map(entries.map(entry => [entry.eventId, entry.id]));
    return rows.map(row => legacy.includes(row) && byEvent.has(row.eventId)
      ? { ...(row.toJSON ? row.toJSON() : row), metadata: { ...row.metadata, entryId: byEvent.get(row.eventId) } }
      : row);
  }
  async function list(userId) {
    const rows = await models.Notification.findAll({ where: { userId, dismissedAt: { [Op.is]: null } }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 50 });
    return enrichLegacy(userId, rows);
  }
  async function page(userId, { page = 1, pageSize = 20 } = {}) {
    const where = { userId, dismissedAt: { [Op.is]: null } };
    const [total, rows, unreadCount] = await Promise.all([
      models.Notification.count({ where }),
      models.Notification.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize }),
      models.Notification.count({ where: { ...where, readAt: { [Op.is]: null } } }),
    ]);
    return { items: await enrichLegacy(userId, rows), page, pageSize, total, hasMore: page * pageSize < total, unreadCount };
  }
  async function unreadCount(userId) {
    return models.Notification.count({ where: { userId, readAt: { [Op.is]: null }, dismissedAt: { [Op.is]: null } } });
  }
  async function markRead(userId, id) {
    const notification = await models.Notification.findOne({ where: { id, userId } });
    if (!notification) throw notFound('Notification');
    if (!notification.readAt) await notification.update({ readAt: new Date() });
    return notification;
  }
  async function dismiss(userId, id) {
    const notification = await models.Notification.findOne({ where: { id, userId } });
    if (!notification) throw notFound('Notification');
    if (!notification.dismissedAt) await notification.update({ dismissedAt: new Date(), readAt: notification.readAt || new Date() });
    return { dismissed: true };
  }
  async function clearAll(userId) {
    const timestamp = new Date();
    const [count] = await models.Notification.update({ dismissedAt: timestamp, readAt: timestamp }, { where: { userId, dismissedAt: { [Op.is]: null } } });
    return { dismissed: count };
  }
  return { emit, list, page, unreadCount, markRead, dismiss, clearAll };
}
module.exports = { createNotificationService };
