'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('ALTER TABLE team_invitations ALTER COLUMN organization_id DROP NOT NULL',{transaction});
      await q.addColumn('team_invitations', 'event_id', {type:S.UUID, allowNull:true, references:{model:'events',key:'id'},onDelete:'CASCADE'}, {transaction});
      await q.addColumn('team_invitations','commission_bps',{type:S.INTEGER,allowNull:false,defaultValue:0},{transaction});
      await q.sequelize.query('ALTER TABLE team_invitations ADD CONSTRAINT event_invitation_commission CHECK (commission_bps BETWEEN 0 AND 4000)',{transaction});
      await q.addIndex('team_invitations',['event_id','email'],{transaction});
      await q.sequelize.query(`ALTER TABLE team_invitations ADD CONSTRAINT team_invitation_scope CHECK ((organization_id IS NOT NULL AND event_id IS NULL) OR (organization_id IS NULL AND event_id IS NOT NULL AND role = 'affiliate'))`,{transaction});
    });
  },
  async down(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      const [rows] = await q.sequelize.query('SELECT id FROM team_invitations WHERE event_id IS NOT NULL LIMIT 1',{transaction});
      if (rows.length) throw new Error('Event invitations exist; archive them before reverting this migration.');
      await q.removeConstraint('team_invitations','team_invitation_scope',{transaction});
      const columns = await q.describeTable('team_invitations',{transaction});
      if (columns.commission_bps) {
        await q.removeConstraint('team_invitations','event_invitation_commission',{transaction});
        await q.removeColumn('team_invitations','commission_bps',{transaction});
      }
      await q.removeColumn('team_invitations','event_id',{transaction});
      await q.sequelize.query('ALTER TABLE team_invitations ALTER COLUMN organization_id SET NOT NULL',{transaction});
    });
  },
};
