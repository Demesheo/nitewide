'use strict';

module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query(`CREATE UNIQUE INDEX notifications_checkout_order_unique
        ON notifications ((metadata->>'orderId')) WHERE kind = 'checkout_pending'`, { transaction });
      // Existing abandoned attempts get the same durable reminder as new ones.
      // Retain original order timestamps and do not touch orders or inventory.
      await q.sequelize.query(`INSERT INTO notifications
        (id, user_id, event_id, kind, title, message, metadata, created_at, updated_at)
        SELECT o.id, o.buyer_user_id, o.event_id, 'checkout_pending', 'Purchase incomplete',
          LEFT('Continue your purchase for ' || e.title || '?', 500),
          jsonb_build_object('orderId', o.id), o.created_at, NOW()
        FROM orders o JOIN events e ON e.id = o.event_id
        WHERE o.status = 'pending' AND o.provider_mode = 'test'
        ON CONFLICT DO NOTHING`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query("DELETE FROM notifications WHERE kind = 'checkout_pending'", { transaction });
      await q.sequelize.query('DROP INDEX notifications_checkout_order_unique', { transaction });
    });
  },
};
