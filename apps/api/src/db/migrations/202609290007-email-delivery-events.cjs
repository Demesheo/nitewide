'use strict';

module.exports = {
  async up(q, S) {
    await q.createTable('email_delivery_events', {
      id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
      webhook_id: { type: S.STRING(160), allowNull: false, unique: true },
      provider_message_id: { type: S.STRING(100), allowNull: false },
      event_type: { type: S.STRING(32), allowNull: false },
      occurred_at: { type: S.DATE, allowNull: false },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
    await q.addIndex('email_delivery_events', ['provider_message_id', 'event_type', 'occurred_at']);
    await q.addIndex('email_outbox', ['provider_message_id']);
    await q.addIndex('email_outbox', ['dedupe_key', 'status']);
    await q.addIndex('audit_logs', ['actor_user_id', 'entity_type', 'entity_id', 'request_id'], {
      unique: true,
      where: { action: 'event.instructions_queued' },
      name: 'audit_instructions_request_unique',
    });
  },
  async down(q) {
    await q.removeIndex('audit_logs', 'audit_instructions_request_unique');
    await q.removeIndex('email_outbox', ['dedupe_key', 'status']);
    await q.removeIndex('email_outbox', ['provider_message_id']);
    await q.dropTable('email_delivery_events');
  },
};
