'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      await q.createTable('business_access_requests', {
        id: { type: S.UUID, primaryKey: true, allowNull: false, defaultValue: S.literal('gen_random_uuid()') },
        display_name: { type: S.STRING(120), allowNull: false }, email: { type: S.STRING(320), allowNull: false }, phone: { type: S.STRING(32), allowNull: false },
        business_name: { type: S.STRING(160), allowNull: false }, role: { type: S.STRING(16), allowNull: false }, details: { type: S.TEXT, allowNull: false },
        status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' }, version: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        reviewed_by_user_id: { type: S.UUID, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' }, reviewed_at: S.DATE, review_reason: S.STRING(500),
        organization_id: { type: S.UUID, references: { model: 'organizations', key: 'id' }, onDelete: 'RESTRICT' },
        onboarding_invitation_id: { type: S.UUID, references: { model: 'onboarding_invitations', key: 'id' }, onDelete: 'RESTRICT' },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.sequelize.query(`ALTER TABLE business_access_requests ADD CONSTRAINT business_access_request_status CHECK (status IN ('pending','approved','declined')),
        ADD CONSTRAINT business_access_request_role CHECK (role IN ('owner','manager'));
        CREATE UNIQUE INDEX business_access_request_pending_email ON business_access_requests (email) WHERE status='pending';
        CREATE INDEX business_access_request_queue ON business_access_requests (status,created_at,id)`, { transaction });
    });
  },
  async down(q) {
    const [rows] = await q.sequelize.query('SELECT 1 FROM business_access_requests LIMIT 1');
    if (rows.length) throw new Error('Access request history exists; preserve it before rollback.');
    await q.dropTable('business_access_requests');
  },
};
