'use strict';

module.exports = {
  async up(q) {
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_event_referral_idx
      ON orders (buyer_user_id, event_affiliate_id) WHERE status='paid' AND event_affiliate_id IS NOT NULL`);
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_org_referral_idx
      ON orders (buyer_user_id, org_affiliate_id) WHERE status='paid' AND event_affiliate_id IS NULL AND org_affiliate_id IS NOT NULL`);
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS guestlist_customer_referral_idx
      ON guestlist_entries (user_id, event_affiliate_id) WHERE event_affiliate_id IS NOT NULL`);
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS invitations_customer_accepted_idx
      ON guestlist_invitations (accepted_by_user_id, invited_by_user_id) WHERE status='accepted'`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS invitations_customer_accepted_idx');
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS guestlist_customer_referral_idx');
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS orders_customer_org_referral_idx');
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS orders_customer_event_referral_idx');
  },
};
