const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class NotificationJob extends Model {}
function initNotificationJob(sequelize) {
  NotificationJob.init({ id: id(), orderId: { type: DataTypes.UUID, allowNull: false, unique: true },
    payload: { type: DataTypes.JSONB, allowNull: false }, status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, availableAt: { type: DataTypes.DATE, allowNull: false },
    leaseToken: DataTypes.UUID, leaseUntil: DataTypes.DATE, plannedAt: DataTypes.DATE, completedAt: DataTypes.DATE, lastError: DataTypes.TEXT,
    totalDeliveries: { type: DataTypes.INTEGER, defaultValue: 0 }, processedDeliveries: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, { sequelize, modelName: 'NotificationJob', tableName: 'notification_jobs', underscored: true });
  return NotificationJob;
}
module.exports = { NotificationJob, initNotificationJob };
