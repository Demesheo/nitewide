'use strict';
module.exports = {
  async up(q,S) {
    await q.sequelize.transaction(async transaction => {
      const reference = model => ({ type: S.UUID,references: { model,key: 'id' },onDelete: 'RESTRICT',onUpdate: 'CASCADE' });
      await q.createTable('support_cases',{ id: { type: S.UUID,allowNull: false,primaryKey: true },title: { type: S.STRING(180),allowNull: false },
        description: { type: S.TEXT,allowNull: false },category: { type: S.STRING(32),allowNull: false },priority: { type: S.STRING(16),allowNull: false,defaultValue: 'normal' },
        status: { type: S.STRING(16),allowNull: false,defaultValue: 'open' },resolution: S.TEXT,organization_id: reference('organizations'),customer_user_id: reference('users'),
        event_id: reference('events'),order_id: reference('orders'),assigned_admin_user_id: reference('users'),
        created_by_admin_user_id: { ...reference('users'),allowNull: false },updated_by_admin_user_id: { ...reference('users'),allowNull: false },
        version: { type: S.INTEGER,allowNull: false,defaultValue: 0 },created_at: { type: S.DATE,allowNull: false },updated_at: { type: S.DATE,allowNull: false },
      },{ transaction });
      await q.sequelize.query(`ALTER TABLE support_cases ADD CONSTRAINT support_case_category CHECK(category IN ('admission','paid_booking','account_access','guestlist','referral','reporting','security','other')),
        ADD CONSTRAINT support_case_priority CHECK(priority IN ('urgent','high','normal','low')),
        ADD CONSTRAINT support_case_status CHECK(status IN ('open','in_progress','resolved','closed')),
        ADD CONSTRAINT support_case_resolution CHECK(status NOT IN ('resolved','closed') OR length(trim(COALESCE(resolution,'')))>=3),
        ADD CONSTRAINT support_case_version CHECK(version>=0);`,{ transaction });
      for (const columns of [['status','created_at','id'],['organization_id','status'],['customer_user_id','status'],['assigned_admin_user_id','status']]) await q.addIndex('support_cases',columns,{ transaction });
    });
  },
  async down(q) { await q.dropTable('support_cases'); },
};
