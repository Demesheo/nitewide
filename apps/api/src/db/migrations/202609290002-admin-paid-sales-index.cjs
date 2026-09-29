'use strict';

module.exports = {
  async up(q) {
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_paid_at_event_idx
      ON orders (paid_at, event_id) WHERE status = 'paid'`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS orders_paid_at_event_idx');
  },
};
