const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class CheckIn extends Model {}
function initCheckIn(sequelize) {
  CheckIn.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, ticketId: DataTypes.UUID, guestlistEntryId: DataTypes.UUID, guestlistPassId: DataTypes.UUID,
    checkedInByUserId: { type: DataTypes.UUID, allowNull: false }, method: { type: DataTypes.ENUM('qr', 'manual'), allowNull: false, defaultValue: 'qr' }, checkedInAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize, modelName: 'CheckIn', tableName: 'check_ins',
    indexes: [{ unique: true, fields: ['ticket_id'] }, { unique: true, fields: ['guestlist_entry_id'] }, { unique: true, fields: ['guestlist_pass_id'] }],
    validate: { exactlyOneCredential() { if ([this.ticketId, this.guestlistEntryId, this.guestlistPassId].filter(Boolean).length !== 1) throw new Error('Exactly one credential is required'); } },
  });
  return CheckIn;
}
module.exports = { CheckIn, initCheckIn };
