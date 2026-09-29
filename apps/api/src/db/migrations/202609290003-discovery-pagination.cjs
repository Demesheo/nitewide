'use strict';

module.exports = {
  async up(q) {
    // ICU numeric/base-strength ordering mirrors the public listing comparator.
    // Index creation stays outside a transaction to avoid blocking writers.
    await q.sequelize.query(`CREATE COLLATION IF NOT EXISTS discovery_en_numeric
      (provider = icu, locale = 'en-u-kn-true-ks-level1', deterministic = false)`);
    await q.sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS events_discovery_page_idx
      ON events (starts_at, id)
      WHERE status = 'published' AND lifecycle_state = 'active' AND is_discoverable = true`);
  },
  async down(q) {
    await q.sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS events_discovery_page_idx');
    await q.sequelize.query('DROP COLLATION IF EXISTS discovery_en_numeric');
  },
};
