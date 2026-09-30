module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      for (const [name, definition] of Object.entries({
        lease_token: { type: S.UUID }, lease_until: { type: S.DATE }, first_attempt_at: { type: S.DATE },
        sender_snapshot: { type: S.STRING(320) }, cycle_attempt_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        replay_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        attempt_history: { type: S.JSONB, allowNull: false, defaultValue: [] },
      })) await q.addColumn('email_outbox', name, definition, { transaction });
      // Old ambiguous sends must not acquire a fresh provider idempotency window.
      await q.sequelize.query(`UPDATE email_outbox SET first_attempt_at=created_at,
        cycle_attempt_count=attempt_count, lease_until=NOW()
        WHERE attempt_count>0 OR status='processing'`, { transaction });
      await q.sequelize.query(`CREATE INDEX email_outbox_worker_ready ON email_outbox(next_attempt_at,created_at,id) WHERE status='pending';
        CREATE INDEX email_outbox_worker_leases ON email_outbox(lease_until,created_at,id) WHERE status='processing';
        CREATE TABLE email_worker_rate (id integer PRIMARY KEY CHECK(id=1), next_slot timestamptz NOT NULL);
        INSERT INTO email_worker_rate VALUES(1,NOW());
        CREATE TABLE background_workers (id uuid PRIMARY KEY, status text NOT NULL, started_at timestamptz NOT NULL DEFAULT NOW(), heartbeat_at timestamptz NOT NULL DEFAULT NOW(), details jsonb NOT NULL DEFAULT '{}')`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query('DROP TABLE background_workers; DROP TABLE email_worker_rate; DROP INDEX email_outbox_worker_ready; DROP INDEX email_outbox_worker_leases', { transaction });
      for (const name of ['lease_token','lease_until','first_attempt_at','sender_snapshot','cycle_attempt_count','replay_count','attempt_history']) {
        await q.removeColumn('email_outbox', name, { transaction });
      }
    });
  },
};
