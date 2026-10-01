const { DataTypes,Model } = require('sequelize');
const { id } = require('./helpers');
class SupportCase extends Model {}
function initSupportCase(sequelize) {
  SupportCase.init({ id: id(),title: { type: DataTypes.STRING(180),allowNull: false },description: { type: DataTypes.TEXT,allowNull: false },
    category: { type: DataTypes.STRING(32),allowNull: false },priority: { type: DataTypes.STRING(16),allowNull: false,defaultValue: 'normal' },
    status: { type: DataTypes.STRING(16),allowNull: false,defaultValue: 'open' },resolution: DataTypes.TEXT,
    organizationId: DataTypes.UUID,customerUserId: DataTypes.UUID,eventId: DataTypes.UUID,orderId: DataTypes.UUID,assignedAdminUserId: DataTypes.UUID,
    createdByAdminUserId: { type: DataTypes.UUID,allowNull: false },updatedByAdminUserId: { type: DataTypes.UUID,allowNull: false },
    version: { type: DataTypes.INTEGER,allowNull: false,defaultValue: 0 },
  },{ sequelize,modelName: 'SupportCase',tableName: 'support_cases',version: true });
  return SupportCase;
}
module.exports = { SupportCase,initSupportCase };
