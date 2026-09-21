'use strict';
module.exports = {
  async up(q, Sequelize) {
    await q.createTable('team_invitations', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      organization_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'CASCADE' },
      invited_by_user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      email: { type: Sequelize.STRING(320), allowNull: false },
      role: { type: Sequelize.STRING(20), allowNull: false },
      token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      accepted_at: { type: Sequelize.DATE },
      accepted_by_user_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await q.addIndex('team_invitations', ['organization_id', 'email']);
  },
  async down(q) { await q.dropTable('team_invitations'); },
};
