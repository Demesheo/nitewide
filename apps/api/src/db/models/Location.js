const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
const { invalidateLocationGeography } = require('../../domain/location-geography');
class Location extends Model {}
function initLocation(sequelize) {
  Location.init({
    id: id(),
    lifecycleState: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'archived']] } },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
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
    countyFips: DataTypes.STRING(5),
    geocodeStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'unverified' },
    geocodeSource: DataTypes.STRING(40),
    geocodeAddressHash: DataTypes.STRING(64),
    geocodeBenchmark: DataTypes.STRING(80),
    geocodeVintage: DataTypes.STRING(80),
    geocodedAt: DataTypes.DATE,
    geocodeAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    geocodeNextAttemptAt: DataTypes.DATE,
    privacy: { type: DataTypes.ENUM('public', 'attendees_only', 'private'), allowNull: false, defaultValue: 'public' },
  }, { sequelize, modelName: 'Location', tableName: 'locations', version: true, hooks: { beforeValidate: invalidateLocationGeography } });
  return Location;
}
module.exports = { Location, initLocation };
