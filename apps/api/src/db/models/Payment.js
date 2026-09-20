const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Payment extends Model {}
function initPayment(sequelize) {
  Payment.init({
    id: id(), orderId: { type: DataTypes.UUID, allowNull: false },
    provider: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'manual' }, providerReference: DataTypes.STRING(160),
    status: { type: DataTypes.ENUM('pending', 'succeeded', 'failed', 'refunded'), allowNull: false, defaultValue: 'pending' },
    amountCents: cents(false), currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' }, processedAt: DataTypes.DATE, metadata: DataTypes.JSONB,
  }, { sequelize, modelName: 'Payment', tableName: 'payments', indexes: [{ unique: true, fields: ['provider', 'provider_reference'] }] });
  return Payment;
}
module.exports = { Payment, initPayment };

