'use strict';
module.exports = {
  async up(q, Sequelize) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('media_assets', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        uploaded_by_user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
        storage_key: { type: Sequelize.STRING(80), allowNull: false, unique: true },
        mime_type: { type: Sequelize.STRING(40), allowNull: false },
        size_bytes: { type: Sequelize.INTEGER, allowNull: false },
        width: { type: Sequelize.INTEGER, allowNull: false }, height: { type: Sequelize.INTEGER, allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false }, updated_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('media_assets', ['uploaded_by_user_id'], { transaction });
      await q.addColumn('events', 'image_asset_id', { type: Sequelize.UUID, allowNull: true, references: { model: 'media_assets', key: 'id' }, onDelete: 'SET NULL' }, { transaction });
      await q.addIndex('events', ['image_asset_id'], { transaction });
    });
  },
  async down(q) { await q.sequelize.transaction(async (transaction) => { await q.removeColumn('events', 'image_asset_id', { transaction }); await q.dropTable('media_assets', { transaction }); }); },
};
