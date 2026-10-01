'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('LOCK TABLE organization_venues IN SHARE ROW EXCLUSIVE MODE', { transaction });
      const [conflicts] = await q.sequelize.query(`SELECT location_id, array_agg(organization_id ORDER BY organization_id) AS organizations
        FROM organization_venues GROUP BY location_id HAVING COUNT(*) > 1 ORDER BY location_id LIMIT 20`, { transaction });
      if (conflicts.length) throw new Error(`Managed venue ownership conflicts must be reviewed before migration; no records were reassigned. ${JSON.stringify(conflicts)}`);
      await q.addIndex('organization_venues', ['location_id'], { name: 'organization_venues_location_exclusive', unique: true, transaction });
      await q.createTable('venue_access', {
        id: { type: S.UUID, allowNull: false, primaryKey: true, defaultValue: S.literal('gen_random_uuid()') },
        organization_id: { type: S.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'RESTRICT' },
        location_id: { type: S.UUID, allowNull: false, references: { model: 'locations', key: 'id' }, onDelete: 'RESTRICT' },
        user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
        role: { type: S.STRING(20), allowNull: false }, status: { type: S.STRING(20), allowNull: false, defaultValue: 'active' },
        version: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.sequelize.query(`ALTER TABLE venue_access ADD CONSTRAINT venue_access_role_check CHECK (role IN ('manager','employee','promoter')),
        ADD CONSTRAINT venue_access_status_check CHECK (status IN ('active','inactive')),
        ADD CONSTRAINT venue_access_parent FOREIGN KEY (organization_id,location_id) REFERENCES organization_venues(organization_id,location_id) ON DELETE RESTRICT`, { transaction });
      await q.addIndex('venue_access', ['location_id', 'user_id'], { unique: true, transaction });
      await q.addIndex('venue_access', ['user_id', 'status', 'organization_id', 'location_id'], { transaction });
      await q.addColumn('event_affiliates', 'venue_access_id', { type: S.UUID, allowNull: true, references: { model: 'venue_access', key: 'id' }, onDelete: 'RESTRICT' }, { transaction });
      await q.sequelize.query(`ALTER TABLE event_affiliates DROP CONSTRAINT event_affiliates_access_scope_check;
        ALTER TABLE event_affiliates ADD CONSTRAINT event_affiliates_access_scope_check CHECK (access_scope IN ('organization','event','venue'));
        ALTER TABLE event_affiliates ADD CONSTRAINT event_affiliates_venue_access_check CHECK (access_scope IS DISTINCT FROM 'venue' OR venue_access_id IS NOT NULL)`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      const [rows] = await q.sequelize.query("SELECT 1 FROM venue_access LIMIT 1", { transaction });
      if (rows.length) throw new Error('Venue access history exists; rollback requires an explicit preservation plan.');
      await q.sequelize.query(`ALTER TABLE event_affiliates DROP CONSTRAINT event_affiliates_venue_access_check;
        ALTER TABLE event_affiliates DROP CONSTRAINT event_affiliates_access_scope_check;
        ALTER TABLE event_affiliates ADD CONSTRAINT event_affiliates_access_scope_check CHECK (access_scope IN ('organization','event'))`, { transaction });
      await q.removeColumn('event_affiliates', 'venue_access_id', { transaction });
      await q.dropTable('venue_access', { transaction });
      await q.removeIndex('organization_venues', 'organization_venues_location_exclusive', { transaction });
    });
  },
};
