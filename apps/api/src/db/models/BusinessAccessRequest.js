const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class BusinessAccessRequest extends Model {}
function initBusinessAccessRequest(sequelize) {
  BusinessAccessRequest.init({ id: id(), displayName: { type: DataTypes.STRING(120), allowNull: false }, email: { type: DataTypes.STRING(320), allowNull: false },
    phone: { type: DataTypes.STRING(32), allowNull: false }, businessName: { type: DataTypes.STRING(160), allowNull: false },
    role: { type: DataTypes.STRING(16), allowNull: false }, details: { type: DataTypes.TEXT, allowNull: false },
    purpose: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'business_access' }, requesterUserId: DataTypes.UUID,
    confirmedAuthorityAt: DataTypes.DATE,
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' }, reviewedByUserId: DataTypes.UUID,
    reviewedAt: DataTypes.DATE, reviewReason: DataTypes.STRING(500), organizationId: DataTypes.UUID, onboardingInvitationId: DataTypes.UUID,
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { sequelize, modelName: 'BusinessAccessRequest', tableName: 'business_access_requests', version: true });
  return BusinessAccessRequest;
}
module.exports = { initBusinessAccessRequest };
