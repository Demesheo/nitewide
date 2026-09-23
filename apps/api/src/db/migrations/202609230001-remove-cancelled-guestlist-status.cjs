'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE guestlist_entries SET status = 'rejected', qr_token_hash = NULL WHERE status = 'cancelled';
      ALTER TABLE guestlist_entries DROP CONSTRAINT IF EXISTS guestlist_entries_status_check;
      ALTER TABLE guestlist_entries ADD CONSTRAINT guestlist_entries_status_check
        CHECK (status IN ('pending','confirmed','rejected','checked_in','no_show'));
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE guestlist_entries DROP CONSTRAINT IF EXISTS guestlist_entries_status_check;
      ALTER TABLE guestlist_entries ADD CONSTRAINT guestlist_entries_status_check
        CHECK (status IN ('pending','confirmed','rejected','checked_in','cancelled','no_show'));
    `);
  },
};
