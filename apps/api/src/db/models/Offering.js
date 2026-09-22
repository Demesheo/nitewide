const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Offering extends Model {}
function initOffering(sequelize) {
  Offering.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false }, description: DataTypes.TEXT,
    kind: { type: DataTypes.ENUM('ticket', 'package', 'reservation'), allowNull: false, defaultValue: 'ticket' },
    priceCents: cents(false, 0), currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    inventoryMode: { type: DataTypes.ENUM('finite', 'unlimited'), allowNull: false, defaultValue: 'finite' },
    quantityTotal: { type: DataTypes.INTEGER, validate: { min: 0 } }, quantitySold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    entriesPerUnit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
    minPerOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
    maxPerOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10, validate: { min: 1 } },
    salesStartAt: DataTypes.DATE, salesEndAt: DataTypes.DATE,
    releaseAfterOfferingId: { type: DataTypes.UUID, allowNull: true },
    visibility: { type: DataTypes.ENUM('public', 'hidden', 'password'), allowNull: false, defaultValue: 'public' },
    accessCodeHash: DataTypes.STRING(128), isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { sequelize, modelName: 'Offering', tableName: 'offerings', indexes: [{ fields: ['event_id', 'is_active', 'sort_order'] }] });
  return Offering;
}
module.exports = { Offering, initOffering };
