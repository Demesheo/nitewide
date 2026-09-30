const { QueryTypes } = require('sequelize');
const { DomainError } = require('../domain/errors');
const { pageResult } = require('./business-read-service');

function createBusinessInstructionsReadService({ models, permissions, email, deliveryTrackingConfigured = false }) {
  async function eventForManager(userId, eventId) {
    const event = await permissions.assertManageEvent(userId, eventId);
    if (event.status !== 'published') throw new DomainError('Instructions require a published event', { code: 'EVENT_NOT_PUBLISHED', status: 409 });
    return event;
  }
  async function preview(userId, eventId, instructions) {
    const event = await eventForManager(userId, eventId);
    const [result] = await models.Event.sequelize.query(`SELECT COUNT(DISTINCT u.id)::integer AS count
      FROM users u WHERE u.is_active = true AND u.lifecycle_state = 'active' AND u.onboarding_pending = false
      AND u.email IS NOT NULL AND u.email <> '' AND
      (EXISTS (SELECT 1 FROM orders o WHERE o.event_id = :eventId AND o.buyer_user_id = u.id AND o.status = 'paid')
      OR EXISTS (SELECT 1 FROM guestlist_entries g WHERE g.event_id = :eventId AND g.user_id = u.id AND g.status IN ('pending','confirmed','checked_in')))`,
    { replacements: { eventId }, type: QueryTypes.SELECT });
    return { eventId, audienceCount: result.count, channel: 'email',
      delivery: email?.enabled ? 'configured' : 'unavailable',
      messagePreview: { subject: `Instructions for ${event.title}`, body: instructions,
        note: 'The event date and booking link are included in the final email template.' } };
  }
  async function history(userId, eventId, { page, pageSize }) {
    await permissions.assertManageEvent(userId, eventId);
    const where = { entityType: 'Event', entityId: eventId, action: 'event.instructions_queued' };
    const [total, logs] = await Promise.all([
      models.AuditLog.count({ where }),
      models.AuditLog.findAll({ where, attributes: ['id', 'actorUserId', 'createdAt', 'after'],
        order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize }),
    ]);
    if (!logs.length) return pageResult([], total, page, pageSize);
    const keys = logs.map((log) => `instructions-${log.id}`);
    const outbox = await models.Event.sequelize.query(`SELECT key, status, COUNT(*)::integer AS count FROM (
      SELECT split_part(ob.dedupe_key, '/', 3) AS key,
      CASE
        WHEN EXISTS (SELECT 1 FROM email_delivery_events de WHERE de.provider_message_id = ob.provider_message_id AND de.event_type = 'email.complained') THEN 'complained'
        WHEN EXISTS (SELECT 1 FROM email_delivery_events de WHERE de.provider_message_id = ob.provider_message_id AND de.event_type = 'email.bounced') THEN 'bounced'
        WHEN EXISTS (SELECT 1 FROM email_delivery_events de WHERE de.provider_message_id = ob.provider_message_id AND de.event_type = 'email.suppressed') THEN 'suppressed'
        WHEN EXISTS (SELECT 1 FROM email_delivery_events de WHERE de.provider_message_id = ob.provider_message_id AND de.event_type = 'email.failed') THEN 'failed'
        WHEN EXISTS (SELECT 1 FROM email_delivery_events de WHERE de.provider_message_id = ob.provider_message_id AND de.event_type = 'email.delivered') THEN 'delivered'
        WHEN ob.status = 'sent' THEN 'acceptedByProvider'
        ELSE ob.status END AS status
      FROM email_outbox ob WHERE split_part(ob.dedupe_key, '/', 1) = 'event'
      AND split_part(ob.dedupe_key, '/', 2) = :eventId AND split_part(ob.dedupe_key, '/', 3) IN (:keys)
      ) delivery_states GROUP BY key, status`, { replacements: { eventId, keys }, type: QueryTypes.SELECT });
    const byKey = new Map(keys.map((key) => [key, {}]));
    for (const row of outbox) byKey.get(row.key)[row.status] = row.count;
    const items = logs.map((log) => {
      const counts = byKey.get(`instructions-${log.id}`) || {};
      return { id: log.id, createdAt: log.createdAt, actorUserId: log.actorUserId,
        audienceCount: log.after?.queued ?? Object.values(counts).reduce((a, b) => a + b, 0),
        statusCounts: { pending: counts.pending || 0, processing: counts.processing || 0,
          acceptedByProvider: counts.acceptedByProvider || 0, delivered: counts.delivered || 0,
          bounced: counts.bounced || 0, complained: counts.complained || 0, suppressed: counts.suppressed || 0,
          failed: counts.failed || 0, expired: counts.expired || 0 },
        trackingConfigured: deliveryTrackingConfigured,
        statusNote: deliveryTrackingConfigured ? 'Provider acceptance is not delivery confirmation.' : 'Delivery tracking is not configured; sent means accepted by provider.' };
    });
    return pageResult(items, total, page, pageSize);
  }
  return { preview, history };
}
module.exports = { createBusinessInstructionsReadService };
