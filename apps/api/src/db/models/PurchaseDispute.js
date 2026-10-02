const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class PurchaseDispute extends Model {}
function initPurchaseDispute(sequelize) {
  PurchaseDispute.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false },
    stripeDisputeId: { type: DataTypes.STRING(255), allowNull: false }, stripeAccountId: { type: DataTypes.STRING(255), allowNull: false },
    providerMode: { type: DataTypes.STRING(8), allowNull: false }, status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'unverified' },
    amountCents: cents(false,0), currency: { type: DataTypes.STRING(3), allowNull: false },
    observationToken: DataTypes.UUID, synchronizedAt: DataTypes.DATE,
  }, { sequelize, modelName: 'PurchaseDispute', tableName: 'purchase_disputes' });
  return PurchaseDispute;
}
module.exports = { PurchaseDispute, initPurchaseDispute };
