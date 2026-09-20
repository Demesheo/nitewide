const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class User extends Model {}
function initUser(sequelize) {
  User.init({
    id: id(),
    email: { type: DataTypes.STRING(320), allowNull: false, unique: true, validate: { isEmail: true } },
    displayName: { type: DataTypes.STRING(120), allowNull: false },
    phone: DataTypes.STRING(32),
    marketingConsentAt: DataTypes.DATE,
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isInternalAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { sequelize, modelName: 'User', tableName: 'users' });
  return User;
}
module.exports = { User, initUser };

