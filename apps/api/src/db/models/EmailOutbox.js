const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class EmailOutbox extends Model {}
function initEmailOutbox(sequelize) {
  EmailOutbox.init({
    id: id(),
    dedupeKey: { type: DataTypes.STRING(256), allowNull: false, unique: true },
    recipientEmail: { type: DataTypes.STRING(320), allowNull: false },
    templateAlias: { type: DataTypes.STRING(100), allowNull: false },
    encryptedVariables: DataTypes.TEXT,
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    attemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    expiresAt: DataTypes.DATE,
    providerMessageId: DataTypes.STRING(100),
    lastError: DataTypes.STRING(160),
  }, { sequelize, modelName: 'EmailOutbox', tableName: 'email_outbox', underscored: true });
  return EmailOutbox;
}
module.exports = { EmailOutbox, initEmailOutbox };
