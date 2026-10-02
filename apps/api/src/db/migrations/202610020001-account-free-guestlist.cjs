'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      await q.addColumn('guestlist_entries', 'guest_name', { type: S.STRING(120) }, { transaction });
      await q.addColumn('guestlist_entries', 'guest_email', { type: S.STRING(320) }, { transaction });
      await q.addColumn('guestlist_entries', 'guest_phone', { type: S.STRING(32) }, { transaction });
      await q.addColumn('guestlist_entries', 'checked_in_spots', { type: S.INTEGER, allowNull: false, defaultValue: 0 }, { transaction });
      await q.sequelize.query(`ALTER TABLE guestlist_entries ALTER COLUMN user_id DROP NOT NULL;
        UPDATE guestlist_entries SET checked_in_spots = party_size WHERE status = 'checked_in';
        ALTER TABLE guestlist_entries ADD CONSTRAINT guestlist_spots_range CHECK (checked_in_spots BETWEEN 0 AND party_size);`, { transaction });
      await q.addColumn('guestlist_invitations', 'name', { type: S.STRING(120) }, { transaction });
      await q.addColumn('guestlist_invitations', 'guestlist_entry_id', { type: S.UUID, references: { model: 'guestlist_entries', key: 'id' }, onDelete: 'SET NULL' }, { transaction });
      await q.addIndex('guestlist_invitations', ['guestlist_entry_id'], { unique: true, transaction });
      // Recover existing accepted invitations without rotating issued group QR
      // credentials. Only new invitations receive individually scannable passes.
      await q.sequelize.query(`UPDATE guestlist_invitations i SET guestlist_entry_id = g.id
        FROM guestlist_entries g WHERE i.status = 'accepted' AND g.event_id = i.event_id AND g.user_id = i.accepted_by_user_id
        AND NOT EXISTS (SELECT 1 FROM guestlist_invitations other WHERE other.status='accepted' AND other.event_id=i.event_id
          AND other.accepted_by_user_id=i.accepted_by_user_id AND other.id::text < i.id::text);`, { transaction });
      await q.createTable('guestlist_passes', {
        id: { type: S.UUID, allowNull: false, primaryKey: true },
        guestlist_entry_id: { type: S.UUID, allowNull: false, references: { model: 'guestlist_entries', key: 'id' }, onDelete: 'CASCADE' },
        position: { type: S.INTEGER, allowNull: false }, qr_token_hash: { type: S.STRING(64), allowNull: false, unique: true },
        status: { type: S.STRING(20), allowNull: false, defaultValue: 'confirmed' }, checked_in_at: S.DATE,
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('guestlist_passes', ['guestlist_entry_id', 'position'], { unique: true, transaction });
      await q.addColumn('check_ins', 'guestlist_pass_id', { type: S.UUID, references: { model: 'guestlist_passes', key: 'id' }, onDelete: 'RESTRICT', unique: true }, { transaction });
      await q.sequelize.query(`ALTER TABLE guestlist_passes ADD CONSTRAINT guestlist_pass_status CHECK (status IN ('confirmed','checked_in'));
        ALTER TABLE guestlist_passes ADD CONSTRAINT guestlist_pass_position CHECK (position BETWEEN 1 AND 20);
        ALTER TABLE check_ins DROP CONSTRAINT check_ins_check;
        ALTER TABLE check_ins ADD CONSTRAINT check_ins_check CHECK (num_nonnulls(ticket_id, guestlist_entry_id, guestlist_pass_id) = 1);`, { transaction });
    });
  },
  async down() { throw new Error('Account-free guestlist admission history cannot be safely downgraded. Restore a reviewed database backup instead.'); },
};
