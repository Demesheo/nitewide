'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        ALTER TABLE organization_owners ADD COLUMN payment_disconnect_authorized boolean NOT NULL DEFAULT false;
        ALTER TABLE payment_accounts
          ADD COLUMN payments_disabled_at timestamptz,
          ADD COLUMN disconnect_status varchar(16) NOT NULL DEFAULT 'none' CHECK (disconnect_status IN ('none','pending','disconnected')),
          ADD COLUMN disconnect_request_id uuid,
          ADD COLUMN disconnect_attempt_at timestamptz,
          ADD COLUMN disconnected_at timestamptz,
          ADD COLUMN disconnect_error_code varchar(80),
          ADD CONSTRAINT payment_disconnect_disabled CHECK (disconnect_status = 'none' OR payments_disabled_at IS NOT NULL);
        CREATE FUNCTION clear_payment_disconnect_permission() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.role <> 'admin' OR NOT NEW.finance_authorized OR NEW.lifecycle_state <> 'active'
            OR OLD.role IS DISTINCT FROM NEW.role OR OLD.lifecycle_state IS DISTINCT FROM NEW.lifecycle_state
          THEN NEW.payment_disconnect_authorized := false; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER clear_payment_disconnect_permission BEFORE UPDATE ON organization_owners
          FOR EACH ROW EXECUTE FUNCTION clear_payment_disconnect_permission();
        ALTER TABLE organization_owners ADD CONSTRAINT payment_disconnect_manager_only
          CHECK (NOT payment_disconnect_authorized OR (role = 'admin' AND finance_authorized AND lifecycle_state = 'active'));
        CREATE INDEX refunds_payment_account_status ON refunds(payment_account_id, status);
      `, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        DROP INDEX refunds_payment_account_status;
        ALTER TABLE organization_owners DROP CONSTRAINT payment_disconnect_manager_only;
        DROP TRIGGER clear_payment_disconnect_permission ON organization_owners;
        DROP FUNCTION clear_payment_disconnect_permission();
        ALTER TABLE organization_owners DROP COLUMN payment_disconnect_authorized;
        ALTER TABLE payment_accounts DROP CONSTRAINT payment_disconnect_disabled,
          DROP COLUMN payments_disabled_at, DROP COLUMN disconnect_status, DROP COLUMN disconnect_request_id,
          DROP COLUMN disconnect_attempt_at, DROP COLUMN disconnected_at, DROP COLUMN disconnect_error_code;
      `, { transaction });
    });
  },
};
