module.exports = {
  async up(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query(`
        ALTER TABLE payment_accounts DROP CONSTRAINT payment_accounts_test_only,
          ADD CONSTRAINT payment_accounts_mode CHECK(mode IN ('test','live'));
        ALTER TABLE stripe_webhook_receipts DROP CONSTRAINT stripe_receipts_test_only,
          ADD CONSTRAINT stripe_receipts_mode CHECK(mode IN ('test','live'));
        ALTER TABLE commission_payments DROP CONSTRAINT commission_payments_test_only,
          ADD CONSTRAINT commission_payments_mode CHECK(provider_mode IN ('test','live'));
        ALTER TABLE purchase_disputes DROP CONSTRAINT purchase_dispute_mode,
          ADD CONSTRAINT purchase_dispute_mode CHECK(provider_mode IN ('test','live'));
        ALTER TABLE orders ADD CONSTRAINT orders_provider_mode CHECK(provider_mode IS NULL OR provider_mode IN ('test','live'));
        ALTER TABLE individual_commission_profiles ADD CONSTRAINT individual_commission_profiles_mode CHECK(provider_mode IN ('test','live'));
      `, { transaction });
    });
  },
  async down() {
    throw new Error('Preserve live payment and commission history; use an explicit forward migration.');
  },
};
