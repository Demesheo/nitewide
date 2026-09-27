'use strict';

module.exports = {
  async up(q, S) {
    await q.addColumn('users', 'email_verified_at', { type: S.DATE, allowNull: true });
    await q.createTable('user_action_tokens', {
      id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
      user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      purpose: { type: S.STRING(32), allowNull: false },
      email: { type: S.STRING(320), allowNull: false },
      token_hash: { type: S.STRING(64), allowNull: false, unique: true },
      expires_at: { type: S.DATE, allowNull: false },
      consumed_at: { type: S.DATE },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
    await q.addIndex('user_action_tokens', ['user_id', 'purpose', 'created_at']);
    await q.createTable('email_outbox', {
      id: { type: S.UUID, primaryKey: true, defaultValue: S.UUIDV4 },
      dedupe_key: { type: S.STRING(256), allowNull: false, unique: true },
      recipient_email: { type: S.STRING(320), allowNull: false },
      template_alias: { type: S.STRING(100), allowNull: false },
      encrypted_variables: { type: S.TEXT, allowNull: true },
      status: { type: S.STRING(24), allowNull: false, defaultValue: 'pending' },
      attempt_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      next_attempt_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      expires_at: { type: S.DATE, allowNull: true },
      provider_message_id: { type: S.STRING(100), allowNull: true },
      last_error: { type: S.STRING(160), allowNull: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
    await q.addIndex('email_outbox', ['status', 'next_attempt_at']);
  },
  async down(q) {
    await q.dropTable('email_outbox');
    await q.dropTable('user_action_tokens');
    await q.removeColumn('users', 'email_verified_at');
  },
};
