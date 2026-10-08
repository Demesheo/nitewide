'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('rundowns', {
        id: { type: S.UUID, primaryKey: true, allowNull: false, defaultValue: S.literal('gen_random_uuid()') },
        user_id: { type: S.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        organization_id: { type: S.UUID, allowNull: true, references: { model: 'organizations', key: 'id' }, onDelete: 'CASCADE' },
        published: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('NOW()') },
        updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('NOW()') },
      }, { transaction });
      await q.addIndex('rundowns', ['user_id'], { name: 'rundowns_user_id_unique', unique: true, transaction });
      await q.addIndex('rundowns', ['organization_id'], { name: 'rundowns_organization_id_unique', unique: true, transaction });
      await q.sequelize.query('ALTER TABLE rundowns ADD CONSTRAINT rundowns_exactly_one_owner CHECK ((user_id IS NULL) <> (organization_id IS NULL))', { transaction });
    });
  },
  async down(q) { await q.dropTable('rundowns'); },
};
