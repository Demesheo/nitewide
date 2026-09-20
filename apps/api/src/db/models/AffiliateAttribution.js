const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class AffiliateAttribution extends Model {}
function initAffiliateAttribution(sequelize) {
  AffiliateAttribution.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, userId: DataTypes.UUID, orgAffiliateId: DataTypes.UUID, eventAffiliateId: DataTypes.UUID,
    action: { type: DataTypes.ENUM('visit', 'guestlist', 'checkout', 'purchase'), allowNull: false }, sessionKey: DataTypes.STRING(100), orderId: DataTypes.UUID, occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, metadata: DataTypes.JSONB,
  }, { sequelize, modelName: 'AffiliateAttribution', tableName: 'affiliate_attributions', indexes: [{ fields: ['event_id', 'occurred_at'] }, { fields: ['event_affiliate_id', 'action'] }] });
  return AffiliateAttribution;
}
module.exports = { AffiliateAttribution, initAffiliateAttribution };

