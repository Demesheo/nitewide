'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('notification_jobs', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        order_id: { type: S.UUID, allowNull: false, unique: true, references: { model: 'orders', key: 'id' }, onDelete: 'CASCADE' },
        payload: { type: S.JSONB, allowNull: false }, status: { type: S.TEXT, allowNull: false, defaultValue: 'pending' },
        attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, available_at: { type: S.DATE, allowNull: false },
        lease_token: S.UUID, lease_until: S.DATE, planned_at: S.DATE, completed_at: S.DATE, last_error: S.TEXT,
        total_deliveries: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, processed_deliveries: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('notification_jobs', ['status', 'available_at', 'lease_until'], { transaction });
      await q.addIndex('notification_jobs', ['created_at', 'id'], { transaction });
      await q.createTable('notification_job_deliveries', {
        job_id: { type: S.UUID, primaryKey: true, allowNull: false, references: { model: 'notification_jobs', key: 'id' }, onDelete: 'CASCADE' },
        dedupe_key: { type: S.TEXT, primaryKey: true, allowNull: false }, user_id: { type: S.UUID, allowNull: false },
        kind: { type: S.TEXT, allowNull: false }, offering_name: S.TEXT,
        processed_at: S.DATE, notification_id: { type: S.UUID, references: { model: 'notifications', key: 'id' }, onDelete: 'SET NULL' },
        skipped: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      }, { transaction });
      await q.addIndex('notification_job_deliveries', ['job_id', 'processed_at', 'dedupe_key'], { transaction });
      await q.sequelize.query("ALTER TABLE notification_jobs ADD CHECK (status IN ('pending','running','retry','completed','failed'))", { transaction });
    });
  },
  async down(q) { await q.sequelize.transaction(async (transaction) => {
    await q.dropTable('notification_job_deliveries', { transaction }); await q.dropTable('notification_jobs', { transaction });
  }); },
};
