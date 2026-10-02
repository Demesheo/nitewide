'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      const user = { type: S.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' };
      const amount = { type: S.INTEGER, allowNull: false };
      await q.createTable('commission_payments', {
        id: { type: S.UUID, primaryKey: true, allowNull: false, defaultValue: S.literal('gen_random_uuid()') },
        organization_id: { type: S.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'RESTRICT' },
        recipient_user_id: user, individual_commission_profile_id: { type: S.UUID, allowNull: false },
        stripe_account_id: { type: S.STRING(160), allowNull: false }, provider_mode: { type: S.STRING(8), allowNull: false, defaultValue: 'test' },
        currency: { type: S.STRING(3), allowNull: false }, commission_cents: amount, fee_allowance_cents: amount, total_cents: amount,
        fee_policy: { type: S.JSONB, allowNull: false }, statement_snapshot: { type: S.JSONB, allowNull: false },
        payment_method: { type: S.STRING(24), allowNull: false }, idempotency_key: { type: S.UUID, allowNull: false }, approval_hash: { type: S.STRING(64), allowNull: false },
        approved_by_user_id: user, approved_at: { type: S.DATE, allowNull: false }, status: { type: S.STRING(24), allowNull: false, defaultValue: 'creating' },
        provider_customer_id: S.STRING(160), provider_invoice_id: { type: S.STRING(160), unique: true }, provider_payment_intent_id: { type: S.STRING(160), unique: true },
        provider_charge_id: { type: S.STRING(160), unique: true }, provider_balance_transaction_id: { type: S.STRING(160), unique: true }, hosted_invoice_url: S.TEXT,
        provider_verification_status: { type: S.STRING(24), allowNull: false, defaultValue: 'pending' }, provider_fee_cents: S.INTEGER, provider_net_cents: S.INTEGER,
        invoicing_fee_cents: S.INTEGER, residual_cents: S.INTEGER, reconciliation_status: { type: S.STRING(32), allowNull: false, defaultValue: 'awaiting_payment' },
        released_at: S.DATE, error_code: S.STRING(80), reconciled_at: S.DATE,
        invalidated_at: S.DATE, invalidation_reason: S.STRING(80), reconciliation_token: S.UUID,
        fee_evidence: S.STRING(24), fee_review: S.JSONB,
        allocations_settled_at: S.DATE,
        verified_observation_token: S.UUID,
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('commission_payments', ['organization_id', 'idempotency_key'], { unique: true, transaction });
      await q.addIndex('commission_payments', ['status', 'updated_at', 'id'], { transaction });
      await q.sequelize.query(`ALTER TABLE commission_payments ADD CONSTRAINT commission_payments_test_only CHECK(provider_mode='test'),
        ADD CONSTRAINT commission_payments_amounts CHECK(commission_cents>0 AND fee_allowance_cents>=0 AND total_cents=commission_cents+fee_allowance_cents),
        ADD CONSTRAINT commission_payments_actual_amounts CHECK((provider_fee_cents IS NULL OR provider_fee_cents>=0) AND (provider_net_cents IS NULL OR provider_net_cents>=0) AND (invoicing_fee_cents IS NULL OR invoicing_fee_cents>=0) AND (residual_cents IS NULL OR residual_cents>=0)),
        ADD CONSTRAINT commission_payments_rail CHECK(payment_method IN ('card','us_bank_account')),
        ADD CONSTRAINT commission_payments_fee_evidence CHECK(fee_evidence IS NULL OR fee_evidence IN ('provider_verified','merchant_reviewed')),
        ADD CONSTRAINT commission_payments_status CHECK(status IN ('creating','awaiting_payment','processing','payment_failed','paid_fee_review','paid','failed','review','disputed','reversed'));
        CREATE FUNCTION preserve_commission_payment_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commission payment approvals cannot be deleted'; END IF;
          IF ROW(NEW.organization_id,NEW.recipient_user_id,NEW.individual_commission_profile_id,NEW.stripe_account_id,NEW.provider_mode,NEW.currency,
            NEW.commission_cents,NEW.fee_allowance_cents,NEW.total_cents,NEW.fee_policy,NEW.statement_snapshot,NEW.payment_method,NEW.idempotency_key,NEW.approval_hash,NEW.approved_by_user_id,NEW.approved_at)
            IS DISTINCT FROM ROW(OLD.organization_id,OLD.recipient_user_id,OLD.individual_commission_profile_id,OLD.stripe_account_id,OLD.provider_mode,OLD.currency,
            OLD.commission_cents,OLD.fee_allowance_cents,OLD.total_cents,OLD.fee_policy,OLD.statement_snapshot,OLD.payment_method,OLD.idempotency_key,OLD.approval_hash,OLD.approved_by_user_id,OLD.approved_at)
          THEN RAISE EXCEPTION 'Commission approval terms are immutable'; END IF;
          IF OLD.provider_customer_id IS NOT NULL AND NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
            OR OLD.provider_invoice_id IS NOT NULL AND NEW.provider_invoice_id IS DISTINCT FROM OLD.provider_invoice_id
            OR OLD.provider_payment_intent_id IS NOT NULL AND NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id
            OR OLD.provider_charge_id IS NOT NULL AND NEW.provider_charge_id IS DISTINCT FROM OLD.provider_charge_id
            OR OLD.provider_balance_transaction_id IS NOT NULL AND NEW.provider_balance_transaction_id IS DISTINCT FROM OLD.provider_balance_transaction_id
          THEN RAISE EXCEPTION 'Bound commission provider references are immutable'; END IF;
          IF OLD.fee_review IS NOT NULL AND NEW.fee_review IS DISTINCT FROM OLD.fee_review THEN RAISE EXCEPTION 'Commission fee reviews are immutable'; END IF;
          IF OLD.allocations_settled_at IS NOT NULL AND NEW.allocations_settled_at IS DISTINCT FROM OLD.allocations_settled_at THEN RAISE EXCEPTION 'Commission allocation settlement history is immutable'; END IF;
          IF OLD.allocations_settled_at IS NOT NULL AND ROW(NEW.provider_fee_cents,NEW.provider_net_cents,NEW.invoicing_fee_cents,NEW.fee_evidence)
            IS DISTINCT FROM ROW(OLD.provider_fee_cents,OLD.provider_net_cents,OLD.invoicing_fee_cents,OLD.fee_evidence)
          THEN RAISE EXCEPTION 'Settled commission fee facts are immutable'; END IF;
          IF OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN RAISE EXCEPTION 'Commission invoice invalidation is permanent'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER commission_payment_approval_history BEFORE UPDATE OR DELETE ON commission_payments FOR EACH ROW EXECUTE FUNCTION preserve_commission_payment_approval();
        CREATE FUNCTION preserve_commission_fee_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.action='commission_payment.invoicing_fee_merchant_reviewed' THEN RAISE EXCEPTION 'Commission fee review audits are immutable'; END IF;
          IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
        END $$;
        CREATE TRIGGER commission_fee_review_audit_history BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION preserve_commission_fee_review_audit();`, { transaction });
    });
  },
  async down() { throw new Error('Preserve commission approvals and provider history; use an explicit forward migration.'); },
};
