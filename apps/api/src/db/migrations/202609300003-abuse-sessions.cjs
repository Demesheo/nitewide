'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.createTable('auth_sessions', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        user_id: { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        expires_at: { type: S.DATE, allowNull: false }, revoked_at: S.DATE,
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('auth_sessions', ['user_id', 'expires_at'], { transaction });
      await q.addIndex('auth_sessions', ['expires_at'], { transaction });
      await q.createTable('abuse_buckets', {
        key: { type: S.STRING(100), primaryKey: true },
        count: { type: S.INTEGER, allowNull: false },
        expires_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('abuse_buckets', ['expires_at'], { transaction });
      // Database triggers cover bulk updates and non-HTTP administration too.
      await q.sequelize.query(`CREATE FUNCTION revoke_user_sessions() RETURNS trigger AS $$
        BEGIN
          IF (TG_TABLE_NAME = 'users' AND (NOT NEW.is_active OR NEW.lifecycle_state <> 'active' OR NEW.onboarding_pending)) THEN
            UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = NEW.id AND revoked_at IS NULL;
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER user_session_revocation AFTER UPDATE OF is_active, lifecycle_state, onboarding_pending ON users
          FOR EACH ROW EXECUTE FUNCTION revoke_user_sessions();
        CREATE FUNCTION revoke_password_sessions() RETURNS trigger AS $$
        BEGIN
          IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at THEN
            UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = NEW.user_id AND revoked_at IS NULL;
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER password_session_revocation AFTER UPDATE ON user_credentials
          FOR EACH ROW EXECUTE FUNCTION revoke_password_sessions();`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('DROP TRIGGER password_session_revocation ON user_credentials; DROP FUNCTION revoke_password_sessions(); DROP TRIGGER user_session_revocation ON users; DROP FUNCTION revoke_user_sessions();', { transaction });
      await q.dropTable('abuse_buckets', { transaction });
      await q.dropTable('auth_sessions', { transaction });
    });
  },
};
