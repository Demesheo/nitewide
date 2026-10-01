const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Refund extends Model {}
function initRefund(sequelize) {
  Refund.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false }, paymentAccountId: { type: DataTypes.UUID, allowNull: false },
    stripeAccountId: { type: DataTypes.STRING(160), allowNull: false }, providerRefundId: { type: DataTypes.STRING(160), unique: true },
    amountCents: cents(false), status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' }, providerReference: { type: DataTypes.STRING(160), unique: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false, unique: true }, requestedByUserId: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: false }, approvedByUserId: { type: DataTypes.UUID, allowNull: true },
    adminOverride: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { sequelize, modelName: 'Refund', tableName: 'refunds' });
  return Refund;
}
module.exports = { Refund, initRefund };
