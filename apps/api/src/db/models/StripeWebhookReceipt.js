const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class StripeWebhookReceipt extends Model {}
function initStripeWebhookReceipt(sequelize) {
  StripeWebhookReceipt.init({ id: id(), stripeEventId: { type: DataTypes.STRING(160), allowNull: false }, stripeAccountId: { type: DataTypes.STRING(160), allowNull: false },
    mode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'test' }, type: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' }, processedAt: DataTypes.DATE,
  }, { sequelize, modelName: 'StripeWebhookReceipt', tableName: 'stripe_webhook_receipts', indexes: [{ unique: true, fields: ['stripe_event_id','stripe_account_id','mode'] }] });
  return StripeWebhookReceipt;
}
module.exports = { StripeWebhookReceipt, initStripeWebhookReceipt };
