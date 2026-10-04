'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      await q.addColumn('business_access_requests', 'purpose', { type: S.STRING(24), allowNull: false, defaultValue: 'business_access' }, { transaction });
      await q.addColumn('business_access_requests', 'requester_user_id', { type: S.UUID, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' }, { transaction });
      // Historical applications have no captured applicant attestation.
      await q.addColumn('business_access_requests', 'confirmed_authority_at', { type: S.DATE }, { transaction });
      await q.sequelize.query(`ALTER TABLE business_access_requests ADD CONSTRAINT business_access_request_purpose
        CHECK (purpose IN ('business_access','new_organization'));
        ALTER TABLE business_access_requests ADD CONSTRAINT business_access_request_identity
        CHECK (purpose <> 'new_organization' OR (requester_user_id IS NOT NULL AND confirmed_authority_at IS NOT NULL));
        CREATE INDEX business_access_request_account_history ON business_access_requests (email,created_at DESC,id);
        CREATE INDEX business_access_request_requester_history ON business_access_requests (requester_user_id,created_at DESC,id)
          WHERE requester_user_id IS NOT NULL`, { transaction });
    });
  },
  async down(q) {
    const [rows] = await q.sequelize.query("SELECT 1 FROM business_access_requests WHERE purpose='new_organization' OR confirmed_authority_at IS NOT NULL LIMIT 1");
    if (rows.length) throw new Error('Applicant identity or authority evidence exists; preserve it before rollback.');
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query('DROP INDEX business_access_request_account_history; DROP INDEX business_access_request_requester_history; ALTER TABLE business_access_requests DROP CONSTRAINT business_access_request_identity, DROP CONSTRAINT business_access_request_purpose', { transaction });
      for (const name of ['confirmed_authority_at', 'requester_user_id', 'purpose']) await q.removeColumn('business_access_requests', name, { transaction });
    });
  },
};
