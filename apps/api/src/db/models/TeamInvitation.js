const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class TeamInvitation extends Model {}
function initTeamInvitation(sequelize) {
  TeamInvitation.init({
    id: id(), organizationId: { type: DataTypes.UUID, allowNull: true }, eventId: { type: DataTypes.UUID, allowNull: true }, invitedByUserId: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false }, role: { type: DataTypes.STRING(20), allowNull: false },
    commissionBps: {type:DataTypes.INTEGER,allowNull:false,defaultValue:0,validate:{min:0,max:4000}},
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true }, expiresAt: { type: DataTypes.DATE, allowNull: false },
    acceptedAt: DataTypes.DATE, acceptedByUserId: DataTypes.UUID,
  }, { sequelize, modelName: 'TeamInvitation', tableName: 'team_invitations', indexes: [{ fields: ['organization_id', 'email'] }, {fields:['event_id','email']}] });
  return TeamInvitation;
}
module.exports = { TeamInvitation, initTeamInvitation };
