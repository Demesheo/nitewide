'use strict';
module.exports = {
  async up(q) {
    // Match the bounded per-event recent-engagement sample without sorting or
    // reading an event's complete attribution history on each discovery page.
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS affiliate_attributions_discovery_engagement_idx
      ON affiliate_attributions(event_id,occurred_at DESC,id DESC)
      INCLUDE (created_at,user_id,session_key,action,event_affiliate_id)
      WHERE action IN ('visit','guestlist','purchase')`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS affiliate_attributions_discovery_engagement_idx');
  },
};
