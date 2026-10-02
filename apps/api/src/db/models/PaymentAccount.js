const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class PaymentAccount extends Model {}
function initPaymentAccount(sequelize) {
  PaymentAccount.init({ id: id(), organizationId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false }, stripeAccountId: { type: DataTypes.STRING(160), unique: true },
    mode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'test' },
    accountApiVersion: { type: DataTypes.STRING(8),allowNull:false,defaultValue:'v2' },
    chargesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, payoutsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    detailsSubmitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, cardPaymentsActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    controllerMatches: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, requirements: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    capabilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }, synchronizedAt: DataTypes.DATE,
    lifecycleState: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
    paymentsDisabledAt: DataTypes.DATE,
    controlVersion: {type:DataTypes.INTEGER,allowNull:false,defaultValue:0},
    disconnectStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' },
    disconnectRequestId: DataTypes.UUID,
    disconnectAttemptAt: DataTypes.DATE,
    disconnectedAt: DataTypes.DATE,
    disconnectErrorCode: DataTypes.STRING(80),
  }, { sequelize, modelName: 'PaymentAccount', tableName: 'payment_accounts', indexes: [{ fields: ['organization_id','lifecycle_state','created_at'] }] });
  return PaymentAccount;
}
module.exports = { PaymentAccount, initPaymentAccount };
