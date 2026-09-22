const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class GuestlistInvitation extends Model {}
function initGuestlistInvitation(sequelize) {
  GuestlistInvitation.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, invitedByUserId: { type: DataTypes.UUID, allowNull: false }, eventAffiliateId: DataTypes.UUID,
    email: DataTypes.STRING(320), phone: DataTypes.STRING(32), tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    partySize: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    expiresAt: { type: DataTypes.DATE, allowNull: false }, acceptedAt: DataTypes.DATE, acceptedByUserId: DataTypes.UUID,
  }, { sequelize, modelName: 'GuestlistInvitation', tableName: 'guestlist_invitations' });
  return GuestlistInvitation;
}
module.exports = { GuestlistInvitation, initGuestlistInvitation };
