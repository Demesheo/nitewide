'use strict';

module.exports = {
  async up(q) {
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS events_admissions_window_page_idx
      ON events (starts_at, id) INCLUDE (ends_at, organization_id, creator_user_id)
      WHERE status = 'published' AND lifecycle_state = 'active'`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS events_admissions_window_page_idx');
  },
};
