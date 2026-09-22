'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('guestlist_invitations', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        event_id: { type: S.UUID, allowNull: false, references: { model: 'events', key: 'id' }, onDelete: 'CASCADE' },
        invited_by_user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
        event_affiliate_id: { type: S.UUID, references: { model: 'event_affiliates', key: 'id' } },
        email: { type: S.STRING(320) }, phone: { type: S.STRING(32) },
        token_hash: { type: S.STRING(64), allowNull: false, unique: true },
        party_size: { type: S.INTEGER, allowNull: false, defaultValue: 1 },
        status: { type: S.STRING(20), allowNull: false, defaultValue: 'pending' },
        expires_at: { type: S.DATE, allowNull: false },
        accepted_at: { type: S.DATE }, accepted_by_user_id: { type: S.UUID, references: { model: 'users', key: 'id' } },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('guestlist_invitations', ['event_id', 'status'], { transaction });
      await q.addIndex('guestlist_invitations', ['email'], { transaction });
      await q.addIndex('guestlist_invitations', ['phone'], { transaction });
      await q.createTable('notifications', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        event_id: { type: S.UUID, references: { model: 'events', key: 'id' }, onDelete: 'SET NULL' },
        kind: { type: S.STRING(50), allowNull: false }, title: { type: S.STRING(160), allowNull: false },
        message: { type: S.STRING(500), allowNull: false }, read_at: { type: S.DATE },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('notifications', ['user_id', 'created_at'], { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.dropTable('notifications', { transaction });
      await q.dropTable('guestlist_invitations', { transaction });
    });
  },
};
