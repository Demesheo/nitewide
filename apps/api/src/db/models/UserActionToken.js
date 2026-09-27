const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class UserActionToken extends Model {}
function initUserActionToken(sequelize) {
  UserActionToken.init({
    id: id(),
    userId: { type: DataTypes.UUID, allowNull: false },
    purpose: { type: DataTypes.STRING(32), allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    consumedAt: DataTypes.DATE,
  }, { sequelize, modelName: 'UserActionToken', tableName: 'user_action_tokens', underscored: true });
  return UserActionToken;
}
module.exports = { UserActionToken, initUserActionToken };
