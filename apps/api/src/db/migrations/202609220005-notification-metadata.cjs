'use strict';
module.exports = {
  async up(q, S) { await q.addColumn('notifications', 'metadata', { type: S.JSONB, allowNull: false, defaultValue: {} }); },
  async down(q) { await q.removeColumn('notifications', 'metadata'); },
};
