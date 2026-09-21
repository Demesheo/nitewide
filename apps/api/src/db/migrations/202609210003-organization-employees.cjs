'use strict';
module.exports = {
  async up(q, Sequelize) {
    await q.createTable('organization_employees', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      organization_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'CASCADE' },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false }, updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await q.addConstraint('organization_employees', { fields: ['organization_id', 'user_id'], type: 'unique', name: 'organization_employees_org_user_unique' });
  },
  async down(q) { await q.dropTable('organization_employees'); },
};
