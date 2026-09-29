const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OrganizationEmployee extends Model {}
function initOrganizationEmployee(sequelize) {
  OrganizationEmployee.init({
    id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
  }, { sequelize, version: true, modelName: 'OrganizationEmployee', tableName: 'organization_employees', indexes: [{ unique: true, fields: ['organization_id', 'user_id'] }] });
  return OrganizationEmployee;
}
module.exports = { OrganizationEmployee, initOrganizationEmployee };
