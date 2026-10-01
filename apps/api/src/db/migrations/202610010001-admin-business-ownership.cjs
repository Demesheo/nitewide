'use strict';

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await q.addColumn('users', 'internal_admin_role', { type: S.STRING(24), allowNull: true }, options);
      await q.sequelize.query("ALTER TABLE users ADD CONSTRAINT users_internal_admin_role_check CHECK (internal_admin_role IS NULL OR internal_admin_role IN ('platform_owner','support','operations','read_only'))", options);
      await q.addColumn('organizations', 'onboarding_established', { type: S.BOOLEAN, allowNull: false, defaultValue: true }, options);
      await q.addColumn('organizations', 'website', { type: S.STRING(2048), allowNull: true }, options);
      await q.addColumn('organizations', 'social_links', { type: S.JSONB, allowNull: false, defaultValue: [] }, options);
      await q.addColumn('organization_owners', 'finance_authorized', { type: S.BOOLEAN, allowNull: false, defaultValue: false }, options);
      await q.sequelize.query("CREATE INDEX onboarding_invitations_pending_business ON onboarding_invitations ((grants #>> '{organizationId}'), created_at DESC) WHERE accepted_at IS NULL AND revoked_at IS NULL", options);
      await q.sequelize.query('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_business_type_check', options);
      await q.sequelize.query("ALTER TABLE organizations ADD CONSTRAINT organizations_business_type_check CHECK (business_type IN ('organization','venue','independent_creator'))", options);
      // Existing IDs, memberships, creator events, and pending invitations remain
      // unchanged. Only new onboarding uses the unified workspace model.
      await q.sequelize.query(`UPDATE organizations SET onboarding_established=false
        WHERE NOT EXISTS (SELECT 1 FROM organization_owners o WHERE o.organization_id=organizations.id AND o.role='owner' AND o.lifecycle_state='active')
          AND EXISTS (SELECT 1 FROM onboarding_invitations i WHERE i.grants->>'organizationId'=organizations.id::text AND i.accepted_at IS NULL AND i.revoked_at IS NULL)`, options);
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      // Refuse rollback while the old application cannot represent new workspaces.
      const [rows] = await q.sequelize.query("SELECT id FROM organizations WHERE business_type='independent_creator' LIMIT 1", options);
      if (rows.length) throw new Error('Unified creator workspaces must be migrated before rolling back ownership support');
      await q.sequelize.query('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_business_type_check', options);
      await q.sequelize.query("ALTER TABLE organizations ADD CONSTRAINT organizations_business_type_check CHECK (business_type IN ('organization','venue'))", options);
      await q.removeColumn('organization_owners', 'finance_authorized', options);
      await q.sequelize.query('DROP INDEX onboarding_invitations_pending_business', options);
      await q.removeColumn('organizations', 'social_links', options);
      await q.removeColumn('organizations', 'website', options);
      await q.removeColumn('organizations', 'onboarding_established', options);
      await q.removeColumn('users', 'internal_admin_role', options);
    });
  },
};
