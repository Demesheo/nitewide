const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class CommissionEarning extends Model {}
function initCommissionEarning(sequelize) {
  CommissionEarning.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false, unique: true },
    organizationId: { type: DataTypes.UUID, allowNull: false }, eventId: { type: DataTypes.UUID, allowNull: false },
    recipientUserId: { type: DataTypes.UUID, allowNull: false }, statementId: { type: DataTypes.UUID, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false }, originalCommissionCents: cents(false),
    unpaidCommissionCents: cents(false), paidCommissionCents: cents(false, 0), refundedCommissionCents: cents(false, 0),
    reservedCommissionCents: cents(false, 0), businessLossCents: cents(false, 0), refundHold: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    disputeHold: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    snapshot: { type: DataTypes.JSONB, allowNull: false },
  }, { sequelize, modelName: 'CommissionEarning', tableName: 'commission_earnings', indexes: [{ fields: ['statement_id', 'created_at', 'id'] }, { fields: ['organization_id', 'recipient_user_id', 'currency'] }] });
  return CommissionEarning;
}
module.exports = { CommissionEarning, initCommissionEarning };
