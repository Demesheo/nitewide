const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class GuestlistPass extends Model {}
function initGuestlistPass(sequelize) {
  GuestlistPass.init({
    id: id(), guestlistEntryId: { type: DataTypes.UUID, allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false },
    qrTokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'confirmed' },
    checkedInAt: DataTypes.DATE,
  }, { sequelize, modelName: 'GuestlistPass', tableName: 'guestlist_passes',
    indexes: [{ unique: true, fields: ['guestlist_entry_id', 'position'] }] });
  return GuestlistPass;
}
module.exports = { GuestlistPass, initGuestlistPass };
