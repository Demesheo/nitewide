'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE user_credentials (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash varchar(128) NOT NULL,
        password_salt varchar(64) NOT NULL,
        password_changed_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS user_credentials;');
  },
};
