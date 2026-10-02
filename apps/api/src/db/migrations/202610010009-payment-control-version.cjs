'use strict';
module.exports = {
  async up(q) {
    await q.sequelize.query('ALTER TABLE payment_accounts ADD COLUMN control_version integer NOT NULL DEFAULT 0 CHECK (control_version >= 0)');
  },
  async down() {throw new Error('Keep payment-control concurrency evidence; use a forward migration.');},
};
