'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      // No backfill: old Stripe idempotency keys must retain their original
      // customer parameters. Their already-bound invoices remain reconcilable.
      await q.addColumn('commission_payments', 'billing_email_snapshot', { type: S.JSONB, allowNull: true }, { transaction });
      await q.sequelize.query(`
        CREATE FUNCTION preserve_commission_billing_email_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.billing_email_snapshot IS DISTINCT FROM OLD.billing_email_snapshot THEN
            RAISE EXCEPTION 'Commission billing email snapshot is immutable';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER commission_billing_email_snapshot_history BEFORE UPDATE OF billing_email_snapshot ON commission_payments
          FOR EACH ROW EXECUTE FUNCTION preserve_commission_billing_email_snapshot();
      `, { transaction });
    });
  },
  async down() {
    throw new Error('Preserve commission billing snapshots and provider history; use an explicit forward migration.');
  },
};
