const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class VenueAccess extends Model {}
function initVenueAccess(sequelize) {
  VenueAccess.init({ id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, locationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false }, role: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['manager', 'employee', 'promoter']] } },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'inactive']] } },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { sequelize, modelName: 'VenueAccess', tableName: 'venue_access', version: true, indexes: [{ unique: true, fields: ['location_id', 'user_id'] }] });
  return VenueAccess;
}
module.exports = { VenueAccess, initVenueAccess };
