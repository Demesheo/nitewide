'use strict';

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
    await q.createTable('saved_events', {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      event_id: { type: S.UUID, allowNull: false, references: { model: 'events', key: 'id' }, onDelete: 'CASCADE' },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    }, { transaction });
    await q.addIndex('saved_events', ['user_id', 'event_id'], { unique: true, name: 'saved_events_user_event_unique', transaction });
    await q.addIndex('saved_events', ['user_id', 'created_at', 'id'], { name: 'saved_events_user_recent_idx', transaction });
    await q.sequelize.query(`CREATE INDEX IF NOT EXISTS notifications_customer_page_idx
      ON notifications (user_id, created_at DESC, id DESC) WHERE dismissed_at IS NULL`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('DROP INDEX IF EXISTS notifications_customer_page_idx', { transaction });
      await q.dropTable('saved_events', { transaction });
    });
  },
};
