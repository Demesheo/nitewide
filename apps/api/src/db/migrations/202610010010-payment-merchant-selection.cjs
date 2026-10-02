'use strict';
module.exports = {
  async up(q) {
    // The temporary merchant lock checks only unresolved refunds. Do not scan
    // the full refund history for every order in a large organization.
    await q.sequelize.query(`CREATE INDEX refunds_unresolved_order_idx ON refunds (order_id)
      WHERE status NOT IN ('succeeded','canceled','cancelled')`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX refunds_unresolved_order_idx');
  },
};
