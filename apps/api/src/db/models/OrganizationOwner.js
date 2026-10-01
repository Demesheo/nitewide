const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OrganizationOwner extends Model {}
function initOrganizationOwner(sequelize) {
  OrganizationOwner.init({
    id: id(),
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lifecycleState: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'archived']] } },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    role: { type: DataTypes.ENUM('owner', 'admin'), allowNull: false, defaultValue: 'owner' },
    financeAuthorized: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { sequelize, version: true, modelName: 'OrganizationOwner', tableName: 'organization_owners', defaultScope: { where: { lifecycleState: 'active' } }, indexes: [{ unique: true, fields: ['organization_id', 'user_id'] }] });
  return OrganizationOwner;
}
module.exports = { OrganizationOwner, initOrganizationOwner };
