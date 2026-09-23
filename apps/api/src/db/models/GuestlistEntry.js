const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class GuestlistEntry extends Model {}
function initGuestlistEntry(sequelize) {
  GuestlistEntry.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false }, eventAffiliateId: DataTypes.UUID,
    source: { type: DataTypes.ENUM('event', 'affiliate'), allowNull: false }, partySize: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
    status: { type: DataTypes.ENUM('pending', 'confirmed', 'rejected', 'checked_in', 'no_show'), allowNull: false, defaultValue: 'pending' },
    qrTokenHash: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    reviewedByUserId: DataTypes.UUID, reviewedAt: DataTypes.DATE, reviewNote: DataTypes.STRING(500), checkedInAt: DataTypes.DATE,
  }, { sequelize, modelName: 'GuestlistEntry', tableName: 'guestlist_entries', indexes: [{ unique: true, fields: ['event_id', 'user_id'] }, { fields: ['event_affiliate_id', 'status'] }] });
  return GuestlistEntry;
}
module.exports = { GuestlistEntry, initGuestlistEntry };
