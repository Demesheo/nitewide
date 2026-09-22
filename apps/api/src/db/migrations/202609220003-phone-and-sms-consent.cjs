'use strict';

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.addColumn('users', 'transactional_sms_consent_at', { type: S.DATE, allowNull: true }, { transaction });
      await q.addColumn('users', 'marketing_sms_consent_at', { type: S.DATE, allowNull: true }, { transaction });
      await q.addColumn('users', 'phone_verified_at', { type: S.DATE, allowNull: true }, { transaction });
      await q.addColumn('team_invitations', 'phone', { type: S.STRING(32), allowNull: true }, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.removeColumn('team_invitations', 'phone', { transaction });
      await q.removeColumn('users', 'phone_verified_at', { transaction });
      await q.removeColumn('users', 'marketing_sms_consent_at', { transaction });
      await q.removeColumn('users', 'transactional_sms_consent_at', { transaction });
    });
  },
};
