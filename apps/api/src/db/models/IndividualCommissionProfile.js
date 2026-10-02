const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class IndividualCommissionProfile extends Model {}
function initIndividualCommissionProfile(sequelize) {
  IndividualCommissionProfile.init({ id: id(), userId: { type: DataTypes.UUID, allowNull: false, unique: true },
    name: { type: DataTypes.STRING(160), allowNull: false }, creationRequestId: { type: DataTypes.UUID, allowNull: false, unique: true },
    provider: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'stripe' }, providerMode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'test' },
    accountApiVersion: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'v2' },
    stripeAccountId: { type: DataTypes.STRING(160), unique: true },
    lifecycleState: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' }, status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
    verifiedAt: DataTypes.DATE, verifiedStripeAccount: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    deauthorizedAt: DataTypes.DATE, paymentsDisabledAt: DataTypes.DATE,
    disconnectStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' }, disconnectRequestId: DataTypes.UUID,
  }, { sequelize, modelName: 'IndividualCommissionProfile', tableName: 'individual_commission_profiles' });
  return IndividualCommissionProfile;
}
module.exports = { IndividualCommissionProfile, initIndividualCommissionProfile };
