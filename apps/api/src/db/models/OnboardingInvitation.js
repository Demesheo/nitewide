const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class OnboardingInvitation extends Model {}
function initOnboardingInvitation(sequelize) {
  OnboardingInvitation.init({
    id: id(), userId: { type: DataTypes.UUID, allowNull: false }, invitedByUserId: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false }, accountMode: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['new', 'existing']] } },
    grants: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, validate: { authorizationIntent(value) {
      if (value.role && !['owner', 'manager'].includes(value.role)) throw new Error('Invalid invitation business role');
      if (value.ownershipIntent && (!['add', 'transfer'].includes(value.ownershipIntent) || !value.organizationId || value.role !== 'owner')) throw new Error('Invalid ownership invitation intent');
      if (value.ownershipIntent === 'transfer' && (!value.outgoingOwnerUserId || !['manager', 'employee', 'remove'].includes(value.outgoingRole) || !Number.isInteger(value.businessVersion) || !Number.isInteger(value.outgoingMembershipVersion))) throw new Error('A transfer requires a versioned outgoing owner and retained role');
    } } }, tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false }, acceptedAt: DataTypes.DATE, revokedAt: DataTypes.DATE,
    resendWindowAt: DataTypes.DATE, resendCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { sequelize, modelName: 'OnboardingInvitation', tableName: 'onboarding_invitations', version: true });
  return OnboardingInvitation;
}
module.exports = { OnboardingInvitation, initOnboardingInvitation };
