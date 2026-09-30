const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class AuthSession extends Model {}
function initAuthSession(sequelize) {
  AuthSession.init({ id: id(), userId: { type: DataTypes.UUID, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false }, revokedAt: DataTypes.DATE,
  }, { sequelize, modelName: 'AuthSession', tableName: 'auth_sessions', underscored: true });
  return AuthSession;
}
class AbuseBucket extends Model {}
function initAbuseBucket(sequelize) {
  AbuseBucket.init({ key: { type: DataTypes.STRING(100), primaryKey: true },
    count: { type: DataTypes.INTEGER, allowNull: false }, expiresAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, modelName: 'AbuseBucket', tableName: 'abuse_buckets', underscored: true, timestamps: false });
  return AbuseBucket;
}
module.exports = { initAuthSession, initAbuseBucket };
