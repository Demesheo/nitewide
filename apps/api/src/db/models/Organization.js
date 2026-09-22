const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class Organization extends Model {}
function initOrganization(sequelize) {
  Organization.init({
    id: id(),
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(180), allowNull: false, unique: true, validate: { is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ } },
    description: DataTypes.TEXT,
    locationId: { type: DataTypes.UUID, allowNull: true },
    planTier: { type: DataTypes.ENUM('free', 'premium'), allowNull: false, defaultValue: 'free' },
    status: { type: DataTypes.ENUM('active', 'suspended', 'closed'), allowNull: false, defaultValue: 'active' },
  }, { sequelize, modelName: 'Organization', tableName: 'organizations' });
  return Organization;
}
module.exports = { Organization, initOrganization };
