const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class TeamInvitation extends Model {}
function initTeamInvitation(sequelize) {
  TeamInvitation.init({
    id: id(), organizationId: { type: DataTypes.UUID, allowNull: false }, invitedByUserId: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false }, role: { type: DataTypes.STRING(20), allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true }, expiresAt: { type: DataTypes.DATE, allowNull: false },
    acceptedAt: DataTypes.DATE, acceptedByUserId: DataTypes.UUID,
  }, { sequelize, modelName: 'TeamInvitation', tableName: 'team_invitations', indexes: [{ fields: ['organization_id', 'email'] }] });
  return TeamInvitation;
}
module.exports = { TeamInvitation, initTeamInvitation };
