const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class CommissionAllocation extends Model {}
function initCommissionAllocation(sequelize) {
  CommissionAllocation.init({ id: id(), paymentId: { type: DataTypes.UUID, allowNull: false }, statementId: { type: DataTypes.UUID, allowNull: false },
    earningId: { type: DataTypes.UUID, allowNull: false }, amountCents: cents(false), paidAmountCents: cents(true),
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'reserved' }, paidAt: DataTypes.DATE, releasedAt: DataTypes.DATE,
  }, { sequelize, modelName: 'CommissionAllocation', tableName: 'commission_allocations', indexes: [{ unique: true, fields: ['payment_id', 'earning_id'] }, { fields: ['earning_id', 'status'] }] });
  return CommissionAllocation;
}
module.exports = { CommissionAllocation, initCommissionAllocation };
