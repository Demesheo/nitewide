const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class CommissionStatement extends Model {}
function initCommissionStatement(sequelize) {
  CommissionStatement.init({ id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, eventId: { type: DataTypes.UUID, allowNull: false },
    recipientUserId: { type: DataTypes.UUID, allowNull: false }, currency: { type: DataTypes.STRING(3), allowNull: false },
    eventTitle: { type: DataTypes.STRING(180), allowNull: false }, availableAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' }, approvedAt: DataTypes.DATE, approvedByUserId: DataTypes.UUID,
  }, { sequelize, modelName: 'CommissionStatement', tableName: 'commission_statements', indexes: [{ unique: true, fields: ['organization_id', 'event_id', 'recipient_user_id', 'currency'] }] });
  return CommissionStatement;
}
module.exports = { CommissionStatement, initCommissionStatement };
