const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OrganizationOwner extends Model {}
function initOrganizationOwner(sequelize) {
  OrganizationOwner.init({
    id: id(),
    organizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    role: { type: DataTypes.ENUM('owner', 'admin'), allowNull: false, defaultValue: 'owner' },
  }, { sequelize, modelName: 'OrganizationOwner', tableName: 'organization_owners', indexes: [{ unique: true, fields: ['organization_id', 'user_id'] }] });
  return OrganizationOwner;
}
module.exports = { OrganizationOwner, initOrganizationOwner };

