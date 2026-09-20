'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE guestlist_entries DROP CONSTRAINT IF EXISTS guestlist_entries_status_check;
      ALTER TABLE guestlist_entries
        ALTER COLUMN status SET DEFAULT 'pending',
        ALTER COLUMN qr_token_hash DROP NOT NULL,
        ADD COLUMN reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN reviewed_at timestamptz,
        ADD COLUMN review_note varchar(500),
        ADD CONSTRAINT guestlist_entries_status_check
          CHECK (status IN ('pending','confirmed','rejected','checked_in','cancelled','no_show'));
      CREATE INDEX guestlist_pending_review_idx ON guestlist_entries (event_id, status, created_at);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS guestlist_pending_review_idx;
      UPDATE guestlist_entries SET status = 'cancelled' WHERE status IN ('pending','rejected');
      UPDATE guestlist_entries SET qr_token_hash = encode(digest(id::text, 'sha256'), 'hex') WHERE qr_token_hash IS NULL;
      ALTER TABLE guestlist_entries DROP CONSTRAINT IF EXISTS guestlist_entries_status_check;
      ALTER TABLE guestlist_entries
        ALTER COLUMN status SET DEFAULT 'confirmed',
        ALTER COLUMN qr_token_hash SET NOT NULL,
        DROP COLUMN review_note,
        DROP COLUMN reviewed_at,
        DROP COLUMN reviewed_by_user_id,
        ADD CONSTRAINT guestlist_entries_status_check
          CHECK (status IN ('confirmed','checked_in','cancelled','no_show'));
    `);
  },
};
