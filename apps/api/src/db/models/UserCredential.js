const { DataTypes, Model } = require('sequelize');

class UserCredential extends Model {}
function initUserCredential(sequelize) {
  UserCredential.init({
    userId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    passwordHash: { type: DataTypes.STRING(128), allowNull: false },
    passwordSalt: { type: DataTypes.STRING(64), allowNull: false },
    passwordChangedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { sequelize, modelName: 'UserCredential', tableName: 'user_credentials' });
  return UserCredential;
}

module.exports = { UserCredential, initUserCredential };
