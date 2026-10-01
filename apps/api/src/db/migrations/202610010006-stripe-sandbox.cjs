'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      const timestamps = { created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } };
      const id = { type: S.UUID, primaryKey: true, allowNull: false, defaultValue: S.literal('gen_random_uuid()') };
      const ref = model => ({ type: S.UUID, references: { model, key: 'id' }, onDelete: 'RESTRICT' });
      const flag = { type: S.BOOLEAN, allowNull: false, defaultValue: false };
      await q.createTable('payment_accounts', { id, organization_id: { ...ref('organizations'), allowNull: false }, name: { type: S.STRING(160), allowNull: false },
        stripe_account_id: { type: S.STRING(160), unique: true }, mode: { type: S.STRING(8), allowNull: false, defaultValue: 'test' },
        charges_enabled: flag, payouts_enabled: flag, details_submitted: flag, card_payments_active: flag, controller_matches: flag,
        requirements: { type: S.JSONB, allowNull: false, defaultValue: {} }, capabilities: { type: S.JSONB, allowNull: false, defaultValue: {} },
        synchronized_at: S.DATE, lifecycle_state: { type: S.STRING(16), allowNull: false, defaultValue: 'active' }, ...timestamps }, { transaction });
      await q.addColumn('organizations','default_payment_account_id',ref('payment_accounts'),{ transaction });
      await q.addColumn('events','payment_account_id',ref('payment_accounts'),{ transaction });
      const orderFields = { payment_account_id: ref('payment_accounts'), stripe_account_id: S.STRING(160), application_fee_cents: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        checkout_session_id: { type: S.STRING(160), unique: true }, reservation_expires_at: S.DATE, reservation_released_at: S.DATE,
        provider_mode: S.STRING(8), provider_verification_status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' }, stripe_payment_intent_id: S.STRING(160), stripe_charge_id: S.STRING(160) };
      for (const [name, definition] of Object.entries(orderFields)) await q.addColumn('orders',name,definition,{ transaction });
      await q.addColumn('offerings','quantity_reserved',{ type: S.INTEGER, allowNull: false, defaultValue: 0 },{ transaction });
      await q.createTable('stripe_webhook_receipts',{ id, stripe_event_id: { type: S.STRING(160), allowNull: false }, stripe_account_id: { type: S.STRING(160), allowNull: false },
        mode: { type: S.STRING(8), allowNull: false, defaultValue: 'test' }, type: { type: S.STRING(160), allowNull: false }, status: { type: S.STRING(24), allowNull: false, defaultValue: 'pending' }, processed_at: S.DATE, ...timestamps },{ transaction });
      await q.addIndex('stripe_webhook_receipts',['stripe_event_id','stripe_account_id','mode'],{ unique: true, transaction });
      await q.createTable('refunds',{ id, order_id: { ...ref('orders'), allowNull: false }, payment_account_id: { ...ref('payment_accounts'), allowNull: false },
        stripe_account_id: { type: S.STRING(160), allowNull: false }, provider_refund_id: { type: S.STRING(160), unique: true }, provider_reference: { type: S.STRING(160), unique: true },
        amount_cents: { type: S.INTEGER, allowNull: false }, currency: { type: S.STRING(3), allowNull: false, defaultValue: 'USD' },
        status: { type: S.STRING(24), allowNull: false, defaultValue: 'pending' }, reason: { type: S.STRING(500), allowNull: false },
        idempotency_key: { type: S.STRING(100), allowNull: false, unique: true }, requested_by_user_id: { ...ref('users'), allowNull: false }, approved_by_user_id: ref('users'),
        admin_override: flag, ...timestamps },{ transaction });
      await q.sequelize.query(`ALTER TABLE payment_accounts ADD CONSTRAINT payment_accounts_test_only CHECK (mode='test'), ADD CONSTRAINT payment_accounts_lifecycle CHECK (lifecycle_state IN ('active','archived'));
        ALTER TABLE offerings ADD CONSTRAINT offerings_quantity_reserved_nonnegative CHECK(quantity_reserved>=0);
        ALTER TABLE orders ADD CONSTRAINT orders_application_fee_nonnegative CHECK(application_fee_cents>=0);
        ALTER TABLE stripe_webhook_receipts ADD CONSTRAINT stripe_receipts_test_only CHECK(mode='test');
        ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK(amount_cents>0);
        CREATE INDEX payment_accounts_organization ON payment_accounts(organization_id,lifecycle_state,created_at,id);
        CREATE INDEX orders_payment_account ON orders(payment_account_id,status);
        CREATE INDEX orders_reservation_expiry ON orders(reservation_expires_at) WHERE status='pending';`,{ transaction });
    });
  },
  async down() { throw new Error('Stripe payment and refund history must be preserved; rollback requires an explicit archival migration.'); },
};
