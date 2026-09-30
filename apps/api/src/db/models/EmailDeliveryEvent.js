const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class EmailDeliveryEvent extends Model {}
function initEmailDeliveryEvent(sequelize) {
  EmailDeliveryEvent.init({
    id: id(),
    webhookId: { type: DataTypes.STRING(160), allowNull: false, unique: true },
    providerMessageId: { type: DataTypes.STRING(100), allowNull: false },
    eventType: { type: DataTypes.STRING(32), allowNull: false },
    occurredAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, modelName: 'EmailDeliveryEvent', tableName: 'email_delivery_events', underscored: true });
  return EmailDeliveryEvent;
}
module.exports = { EmailDeliveryEvent, initEmailDeliveryEvent };
