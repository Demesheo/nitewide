const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class User extends Model {}
function initUser(sequelize) {
  User.init({
    id: id(),
    lifecycleState: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'archived']] } },
    independentCreator: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    onboardingPending: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    email: { type: DataTypes.STRING(320), allowNull: false, unique: true, validate: { isEmail: true } },
    displayName: { type: DataTypes.STRING(120), allowNull: false },
    phone: DataTypes.STRING(32),
    marketingConsentAt: DataTypes.DATE,
    transactionalSmsConsentAt: DataTypes.DATE,
    marketingSmsConsentAt: DataTypes.DATE,
    phoneVerifiedAt: DataTypes.DATE,
    emailVerifiedAt: DataTypes.DATE,
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isInternalAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { sequelize, modelName: 'User', tableName: 'users', version: true });
  return User;
}
module.exports = { User, initUser };
