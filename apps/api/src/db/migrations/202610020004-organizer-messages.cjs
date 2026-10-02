'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      const ref = table => ({ type: S.UUID, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
      const timestamps = { created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } };
      await q.createTable('organizer_threads', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        order_id: { ...ref('orders'), allowNull: false, unique: true },
        event_id: { ...ref('events'), allowNull: false }, organization_id: ref('organizations'),
        customer_user_id: { ...ref('users'), allowNull: false },
        last_message_at: { type: S.DATE, allowNull: false }, last_message_preview: { type: S.STRING(200), allowNull: false }, ...timestamps,
      }, { transaction });
      await q.createTable('organizer_messages', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, thread_id: { ...ref('organizer_threads'), allowNull: false },
        sender_user_id: { ...ref('users'), allowNull: false }, sender_side: { type: S.STRING(16), allowNull: false },
        body: { type: S.TEXT, allowNull: false }, kind: { type: S.STRING(16), allowNull: false, defaultValue: 'question' },
        idempotency_key: { type: S.UUID, allowNull: false }, ...timestamps,
      }, { transaction });
      await q.createTable('organizer_thread_reads', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, thread_id: { ...ref('organizer_threads'), allowNull: false },
        user_id: { ...ref('users'), allowNull: false }, last_read_at: { type: S.DATE, allowNull: false }, ...timestamps,
      }, { transaction });
      await q.createTable('order_refund_requests', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, order_id: { ...ref('orders'), allowNull: false, unique: true },
        thread_id: { ...ref('organizer_threads'), allowNull: false }, customer_user_id: { ...ref('users'), allowNull: false },
        kind: { type: S.STRING(16), allowNull: false }, reason: { type: S.TEXT, allowNull: false },
        status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' }, requested_at: { type: S.DATE, allowNull: false },
        reviewed_by_user_id: ref('users'), reviewed_at: S.DATE, resolution: S.TEXT, decision_key: S.UUID, ...timestamps,
      }, { transaction });
      await q.addIndex('organizer_threads', ['customer_user_id', 'last_message_at', 'id'], { transaction });
      await q.addIndex('organizer_threads', ['organization_id', 'last_message_at', 'id'], { transaction });
      await q.addIndex('organizer_messages', ['sender_user_id', 'idempotency_key'], { unique: true, transaction });
      await q.addIndex('organizer_messages', ['thread_id', 'created_at', 'id'], { transaction });
      await q.addIndex('organizer_thread_reads', ['thread_id', 'user_id'], { unique: true, transaction });
      await q.addIndex('order_refund_requests', ['status', 'requested_at'], { transaction });
      await q.sequelize.query(`ALTER TABLE organizer_messages
        ADD CONSTRAINT organizer_message_side CHECK(sender_side IN ('customer','business')),
        ADD CONSTRAINT organizer_message_kind CHECK(kind IN ('question','refund','cancellation','reply')),
        ADD CONSTRAINT organizer_message_length CHECK(length(trim(body)) BETWEEN 1 AND 2000);
        ALTER TABLE order_refund_requests
        ADD CONSTRAINT organizer_refund_kind CHECK(kind IN ('refund','cancellation')),
        ADD CONSTRAINT organizer_refund_status CHECK(status IN ('pending','approved','denied','resolved'));`, { transaction });
    });
  },
  async down(q) {
    for (const table of ['order_refund_requests', 'organizer_thread_reads', 'organizer_messages', 'organizer_threads']) await q.dropTable(table);
  },
};
