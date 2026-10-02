'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      const timestamps = { created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } };
      const uuid = (table) => ({ type: S.UUID, allowNull: false, references: { model: table, key: 'id' }, onDelete: 'RESTRICT' });
      const cents = () => ({ type: S.INTEGER, allowNull: false, defaultValue: 0 });
      await q.addColumn('organizations', 'commission_minimum_subtotal_cents', { type: S.INTEGER, allowNull: false, defaultValue: 1000 }, { transaction });
      await q.addColumn('events', 'commission_minimum_subtotal_cents', { type: S.INTEGER }, { transaction });
      await q.addColumn('orders', 'commission_snapshot', { type: S.JSONB, allowNull: false, defaultValue: {} }, { transaction });
      for (const column of ['refunded_total_cents', 'refunded_subtotal_cents', 'refunded_commission_cents']) await q.addColumn('orders', column, cents(), { transaction });
      await q.createTable('individual_commission_profiles', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, user_id: { ...uuid('users'), unique: true },
        name: { type: S.STRING(160), allowNull: false }, creation_request_id: { type: S.UUID, allowNull: false, unique: true },
        provider: { type: S.STRING(16), allowNull: false, defaultValue: 'stripe' }, provider_mode: { type: S.STRING(8), allowNull: false, defaultValue: 'test' },
        account_api_version: { type: S.STRING(8), allowNull: false, defaultValue: 'v2' }, stripe_account_id: { type: S.STRING(160), unique: true },
        lifecycle_state: { type: S.STRING(16), allowNull: false, defaultValue: 'active' }, status: { type: S.STRING(16), allowNull: false, defaultValue: 'active' },
        verified_at: S.DATE, verified_stripe_account: { type: S.JSONB, allowNull: false, defaultValue: {} },
        deauthorized_at: S.DATE, payments_disabled_at: S.DATE, disconnect_status: { type: S.STRING(16), allowNull: false, defaultValue: 'none' }, disconnect_request_id: S.UUID, ...timestamps,
      }, { transaction });
      await q.addConstraint('commission_payments', { fields: ['individual_commission_profile_id'], type: 'foreign key',
        name: 'commission_payment_individual_profile', references: { table: 'individual_commission_profiles', field: 'id' }, onDelete: 'RESTRICT', transaction });
      await q.createTable('commission_statements', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, organization_id: uuid('organizations'), event_id: uuid('events'), recipient_user_id: uuid('users'),
        currency: { type: S.STRING(3), allowNull: false }, event_title: { type: S.STRING(180), allowNull: false }, available_at: { type: S.DATE, allowNull: false },
        status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' }, approved_at: S.DATE, approved_by_user_id: { type: S.UUID, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' }, ...timestamps,
      }, { transaction });
      await q.addIndex('commission_statements', ['organization_id', 'event_id', 'recipient_user_id', 'currency'], { unique: true, transaction });
      await q.createTable('commission_earnings', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, order_id: { ...uuid('orders'), unique: true }, organization_id: uuid('organizations'), event_id: uuid('events'),
        recipient_user_id: uuid('users'), statement_id: uuid('commission_statements'), currency: { type: S.STRING(3), allowNull: false },
        original_commission_cents: cents(), unpaid_commission_cents: cents(), paid_commission_cents: cents(), refunded_commission_cents: cents(), reserved_commission_cents: cents(), business_loss_cents: cents(),
        refund_hold: { type: S.BOOLEAN, allowNull: false, defaultValue: false }, dispute_hold: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
        snapshot: { type: S.JSONB, allowNull: false }, ...timestamps,
      }, { transaction });
      await q.addIndex('commission_earnings', ['statement_id', 'created_at', 'id'], { transaction });
      await q.addIndex('commission_earnings', ['organization_id', 'recipient_user_id', 'currency'], { transaction });
      await q.createTable('commission_allocations', {
        id: { type: S.UUID, primaryKey: true, allowNull: false }, payment_id: uuid('commission_payments'), statement_id: uuid('commission_statements'), earning_id: uuid('commission_earnings'),
        amount_cents: cents(), paid_amount_cents: { type: S.INTEGER }, status: { type: S.STRING(16), allowNull: false, defaultValue: 'reserved' }, paid_at: S.DATE, released_at: S.DATE, ...timestamps,
      }, { transaction });
      await q.addIndex('commission_allocations', ['payment_id', 'earning_id'], { unique: true, transaction });
      await q.addIndex('commission_allocations', ['earning_id', 'status'], { transaction });
      await q.sequelize.query(`ALTER TABLE organizations ADD CONSTRAINT organization_commission_minimum CHECK (commission_minimum_subtotal_cents BETWEEN 1000 AND 100000000);
        ALTER TABLE events ADD CONSTRAINT event_commission_minimum CHECK (commission_minimum_subtotal_cents IS NULL OR commission_minimum_subtotal_cents BETWEEN 1000 AND 100000000);
        ALTER TABLE commission_statements ADD CONSTRAINT commission_statement_status CHECK (status IN ('pending','approved'));
        ALTER TABLE commission_allocations ADD CONSTRAINT commission_allocation_status CHECK (status IN ('reserved','paid','released'));
        ALTER TABLE commission_allocations ADD CONSTRAINT commission_allocation_amount CHECK (amount_cents > 0);
        ALTER TABLE commission_allocations ADD CONSTRAINT commission_allocation_credit CHECK (
          (status='paid' AND paid_amount_cents IS NOT NULL AND paid_amount_cents BETWEEN 0 AND amount_cents) OR (status<>'paid' AND paid_amount_cents IS NULL));
        ALTER TABLE commission_earnings ADD CONSTRAINT commission_earning_balance CHECK (
          original_commission_cents > 0 AND unpaid_commission_cents >= 0 AND paid_commission_cents >= 0 AND refunded_commission_cents >= 0 AND business_loss_cents >= 0
        AND reserved_commission_cents BETWEEN 0 AND unpaid_commission_cents AND refunded_commission_cents <= original_commission_cents
          AND unpaid_commission_cents + paid_commission_cents + refunded_commission_cents - business_loss_cents = original_commission_cents);
        CREATE FUNCTION commission_merchant_applied_ready(applied jsonb, observed_at timestamptz) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
        DECLARE applied_at timestamptz; applied_text text;
        BEGIN
          IF applied='true'::jsonb THEN RETURN true; END IF;
          IF jsonb_typeof(applied) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
          applied_text := applied#>>'{}';
          IF applied_text !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$' THEN RETURN false; END IF;
          applied_at := applied_text::timestamptz;
          RETURN applied_at<=observed_at;
        EXCEPTION WHEN OTHERS THEN RETURN false;
        END $$;
        CREATE FUNCTION preserve_commission_earning_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original commission earning history cannot be deleted'; END IF;
          IF ROW(NEW.order_id,NEW.organization_id,NEW.event_id,NEW.recipient_user_id,NEW.statement_id,NEW.currency,NEW.original_commission_cents,NEW.snapshot)
            IS DISTINCT FROM ROW(OLD.order_id,OLD.organization_id,OLD.event_id,OLD.recipient_user_id,OLD.statement_id,OLD.currency,OLD.original_commission_cents,OLD.snapshot)
          THEN RAISE EXCEPTION 'Original commission earning history is immutable'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER commission_earning_history BEFORE UPDATE OR DELETE ON commission_earnings FOR EACH ROW EXECUTE FUNCTION preserve_commission_earning_history();
        CREATE FUNCTION preserve_commission_allocation_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commission allocation history cannot be deleted'; END IF;
          IF ROW(NEW.payment_id,NEW.statement_id,NEW.earning_id,NEW.amount_cents) IS DISTINCT FROM ROW(OLD.payment_id,OLD.statement_id,OLD.earning_id,OLD.amount_cents)
            OR (OLD.status<>'reserved' AND ROW(NEW.status,NEW.paid_amount_cents,NEW.paid_at,NEW.released_at) IS DISTINCT FROM ROW(OLD.status,OLD.paid_amount_cents,OLD.paid_at,OLD.released_at))
          THEN RAISE EXCEPTION 'Commission allocation history is immutable'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER commission_allocation_history BEFORE UPDATE OR DELETE ON commission_allocations FOR EACH ROW EXECUTE FUNCTION preserve_commission_allocation_history();
        CREATE FUNCTION preserve_order_commission_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF ROW(NEW.commission_snapshot,NEW.affiliate_commission_cents,NEW.subtotal_cents,NEW.total_cents,NEW.event_affiliate_id,NEW.org_affiliate_id)
            IS DISTINCT FROM ROW(OLD.commission_snapshot,OLD.affiliate_commission_cents,OLD.subtotal_cents,OLD.total_cents,OLD.event_affiliate_id,OLD.org_affiliate_id)
          THEN RAISE EXCEPTION 'Checkout commission purchase terms are immutable'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER order_commission_history BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION preserve_order_commission_history();`, { transaction });
    });
  },
  async down() { throw new Error('Commission and recipient history cannot be safely downgraded. Restore a reviewed database backup instead.'); },
};
