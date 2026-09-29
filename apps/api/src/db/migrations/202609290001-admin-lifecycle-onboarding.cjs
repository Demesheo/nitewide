'use strict';

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      for (const table of ['users', 'organizations', 'events', 'locations']) {
        await q.addColumn(table, 'lifecycle_state', { type: S.STRING(20), allowNull: false, defaultValue: 'active' }, options);
        if (table !== 'events') await q.addColumn(table, 'version', { type: S.INTEGER, allowNull: false, defaultValue: 0 }, options);
        await q.sequelize.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_lifecycle_state_check" CHECK (lifecycle_state IN ('active','suspended','archived'))`, options);
      }
      await q.addColumn('users', 'independent_creator', { type: S.BOOLEAN, allowNull: false, defaultValue: false }, options);
      for (const table of ['organization_owners', 'organization_employees', 'org_affiliates', 'event_affiliates']) await q.addColumn(table, 'version', { type: S.INTEGER, allowNull: false, defaultValue: 0 }, options);
      await q.addColumn('organization_owners', 'lifecycle_state', { type: S.STRING(20), allowNull: false, defaultValue: 'active' }, options);
      await q.addColumn('users', 'onboarding_pending', { type: S.BOOLEAN, allowNull: false, defaultValue: false }, options);
      await q.addColumn('organizations', 'business_type', { type: S.STRING(20), allowNull: false, defaultValue: 'organization' }, options);
      await q.sequelize.query("ALTER TABLE organizations ADD CONSTRAINT organizations_business_type_check CHECK (business_type IN ('organization','venue'))", options);
      await q.sequelize.query("UPDATE users SET lifecycle_state='suspended' WHERE is_active=false", options);
      await q.sequelize.query("UPDATE organizations SET lifecycle_state=CASE WHEN status='closed' THEN 'archived' ELSE 'suspended' END WHERE status <> 'active'", options);
      await q.sequelize.query("UPDATE users SET independent_creator=true WHERE id IN (SELECT creator_user_id FROM events WHERE organization_id IS NULL)", options);
      const timestamps = { created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW } };
      await q.createTable('organization_venues', {
        id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
        organization_id: { type: S.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'RESTRICT' },
        location_id: { type: S.UUID, allowNull: false, references: { model: 'locations', key: 'id' }, onDelete: 'RESTRICT' },
        ...timestamps,
      }, options);
      await q.addIndex('organization_venues', ['organization_id', 'location_id'], { unique: true, ...options });
      // Backfill every real saved/event venue, retaining the legacy default pointer.
      await q.sequelize.query(`INSERT INTO organization_venues (id,organization_id,location_id,created_at,updated_at)
        SELECT gen_random_uuid(),organization_id,location_id,NOW(),NOW() FROM (
          SELECT id AS organization_id,location_id FROM organizations WHERE location_id IS NOT NULL
          UNION SELECT organization_id,location_id FROM events WHERE organization_id IS NOT NULL AND location_id IS NOT NULL
        ) AS existing`, options);
      await q.createTable('onboarding_invitations', {
        id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
        user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
        invited_by_user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
        email: { type: S.STRING(320), allowNull: false },
        account_mode: { type: S.STRING(20), allowNull: false },
        grants: { type: S.JSONB, allowNull: false, defaultValue: {} },
        token_hash: { type: S.STRING(64), allowNull: false, unique: true },
        expires_at: { type: S.DATE, allowNull: false }, accepted_at: S.DATE, revoked_at: S.DATE,
        resend_window_at: S.DATE, resend_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        version: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, ...timestamps,
      }, options);
      await q.addIndex('onboarding_invitations', ['user_id', 'created_at'], options);
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await q.dropTable('onboarding_invitations', options); await q.dropTable('organization_venues', options);
      for (const table of ['organization_owners', 'organization_employees', 'org_affiliates', 'event_affiliates']) await q.removeColumn(table, 'version', options);
      await q.removeColumn('organization_owners', 'lifecycle_state', options);
      await q.removeColumn('organizations', 'business_type', options);
      await q.removeColumn('users', 'independent_creator', options); await q.removeColumn('users', 'onboarding_pending', options);
      for (const table of ['users', 'organizations', 'events', 'locations']) {
        await q.removeColumn(table, 'lifecycle_state', options);
        if (table !== 'events') await q.removeColumn(table, 'version', options);
      }
    });
  },
};
