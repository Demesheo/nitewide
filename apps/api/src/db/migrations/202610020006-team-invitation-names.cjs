'use strict';
module.exports = {
  async up(q, S) {
    await q.addColumn('team_invitations', 'name', { type: S.STRING(120), allowNull: true });
  },
  async down(q) { await q.removeColumn('team_invitations', 'name'); },
};
