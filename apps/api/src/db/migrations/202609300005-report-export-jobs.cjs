'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('report_export_jobs', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        input: { type: S.JSONB, allowNull: false }, auth_stamp: { type: S.TEXT, allowNull: false },
        status: { type: S.TEXT, allowNull: false }, metadata: { type: S.JSONB, allowNull: false, defaultValue: {} },
        total_rows: { type: S.BIGINT, allowNull: false, defaultValue: 0 },
        processed_rows: { type: S.BIGINT, allowNull: false, defaultValue: 0 },
        lease_token: S.UUID, lease_until: S.DATE, snapshot_at: S.DATE, last_error: S.TEXT,
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
        expires_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('report_export_jobs', ['user_id', 'created_at'], { transaction });
      await q.addIndex('report_export_jobs', ['status', 'lease_until'], { transaction });
      await q.addIndex('report_export_jobs', ['expires_at'], { transaction });
      await q.createTable('report_export_rows', {
        job_id: { type: S.UUID, primaryKey: true, references: { model: 'report_export_jobs', key: 'id' }, onDelete: 'CASCADE' },
        sequence: { type: S.BIGINT, primaryKey: true }, section: { type: S.TEXT, allowNull: false },
        payload: { type: S.JSONB, allowNull: false },
      }, { transaction });
      await q.createTable('report_export_chunks', {
        job_id: { type: S.UUID, primaryKey: true, references: { model: 'report_export_jobs', key: 'id' }, onDelete: 'CASCADE' },
        sequence: { type: S.BIGINT, primaryKey: true }, content: { type: S.TEXT, allowNull: false },
      }, { transaction });
      await q.sequelize.query(`ALTER TABLE report_export_jobs ADD CONSTRAINT report_export_status
        CHECK (status IN ('queued','snapshotting','streaming','rendering','ready','failed'));`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.dropTable('report_export_chunks', { transaction });
      await q.dropTable('report_export_rows', { transaction });
      await q.dropTable('report_export_jobs', { transaction });
    });
  },
};
