'use strict';
module.exports = {
  async up(q, S) { await q.addColumn('orders', 'request_fingerprint', { type: S.STRING(64), allowNull: true }); },
  async down(q) { await q.removeColumn('orders', 'request_fingerprint'); },
};
