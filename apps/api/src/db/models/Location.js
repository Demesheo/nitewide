const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class Location extends Model {}
function initLocation(sequelize) {
  Location.init({
    id: id(),
    name: DataTypes.STRING(180),
    addressLine1: DataTypes.STRING(180),
    addressLine2: DataTypes.STRING(180),
    city: { type: DataTypes.STRING(100), allowNull: false },
    region: DataTypes.STRING(100),
    postalCode: DataTypes.STRING(24),
    countryCode: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'US', validate: { len: [2, 2] } },
    timezone: { type: DataTypes.STRING(64), allowNull: false },
    latitude: { type: DataTypes.DECIMAL(9, 6), validate: { min: -90, max: 90 } },
    longitude: { type: DataTypes.DECIMAL(9, 6), validate: { min: -180, max: 180 } },
    geo: DataTypes.GEOGRAPHY('POINT', 4326),
    privacy: { type: DataTypes.ENUM('public', 'attendees_only', 'private'), allowNull: false, defaultValue: 'public' },
  }, { sequelize, modelName: 'Location', tableName: 'locations' });
  return Location;
}
module.exports = { Location, initLocation };

