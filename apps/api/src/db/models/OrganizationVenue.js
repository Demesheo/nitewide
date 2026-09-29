const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OrganizationVenue extends Model {}
function initOrganizationVenue(sequelize) {
  OrganizationVenue.init({ id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, locationId: { type: DataTypes.UUID, allowNull: false } }, { sequelize, modelName: 'OrganizationVenue', tableName: 'organization_venues', indexes: [{ unique: true, fields: ['organization_id', 'location_id'] }] });
  return OrganizationVenue;
}
module.exports = { OrganizationVenue, initOrganizationVenue };
