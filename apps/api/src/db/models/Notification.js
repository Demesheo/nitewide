const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class Notification extends Model {}
function initNotification(sequelize) {
  Notification.init({ id: id(), userId: { type: DataTypes.UUID, allowNull: false }, eventId: DataTypes.UUID,
    kind: { type: DataTypes.STRING(50), allowNull: false }, title: { type: DataTypes.STRING(160), allowNull: false },
    message: { type: DataTypes.STRING(500), allowNull: false }, metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }, readAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Notification', tableName: 'notifications' });
  return Notification;
}
module.exports = { Notification, initNotification };
