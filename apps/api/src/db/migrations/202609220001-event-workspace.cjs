'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.addColumn('organizations', 'location_id', { type: S.UUID, allowNull: true, references: { model: 'locations', key: 'id' }, onDelete: 'SET NULL' }, { transaction });
      await q.sequelize.query(`UPDATE organizations o SET location_id = (
        SELECT e.location_id FROM events e WHERE e.organization_id = o.id AND e.location_id IS NOT NULL
        ORDER BY e.created_at ASC, e.id ASC LIMIT 1
      )`, { transaction });
      await q.addColumn('offerings', 'release_after_offering_id', { type: S.UUID, allowNull: true, references: { model: 'offerings', key: 'id' }, onDelete: 'SET NULL' }, { transaction });
      await q.addIndex('offerings', ['release_after_offering_id'], { transaction });
    });
  },
  async down(q) {
    await q.removeColumn('offerings', 'release_after_offering_id');
    await q.removeColumn('organizations', 'location_id');
  },
};
