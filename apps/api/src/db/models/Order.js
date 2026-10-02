const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Order extends Model {}
function initOrder(sequelize) {
  Order.init({
    id: id(), buyerUserId: { type: DataTypes.UUID, allowNull: false }, eventId: { type: DataTypes.UUID, allowNull: false },
    paymentAccountId: DataTypes.UUID, stripeAccountId: DataTypes.STRING(160), applicationFeeCents: cents(false, 0),
    checkoutSessionId: { type: DataTypes.STRING(160), unique: true }, reservationExpiresAt: DataTypes.DATE, reservationReleasedAt: DataTypes.DATE,
    providerMode: { type: DataTypes.STRING(8), allowNull: true }, providerVerificationStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    stripePaymentIntentId: DataTypes.STRING(160), stripeChargeId: DataTypes.STRING(160),
    status: { type: DataTypes.ENUM('pending', 'paid', 'cancelled', 'refunded'), allowNull: false, defaultValue: 'pending' },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    subtotalCents: cents(false, 0), platformFeeCents: cents(false, 0), totalCents: cents(false, 0), affiliateCommissionCents: cents(false, 0),
    orgAffiliateId: DataTypes.UUID, eventAffiliateId: DataTypes.UUID,
    pricingPlanSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    commissionSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    refundedTotalCents: cents(false, 0), refundedSubtotalCents: cents(false, 0), refundedCommissionCents: cents(false, 0),
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false }, requestFingerprint: DataTypes.STRING(64), paidAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Order', tableName: 'orders', indexes: [{ unique: true, fields: ['buyer_user_id', 'idempotency_key'] }, { fields: ['event_id', 'status', 'created_at'] }] });
  return Order;
}
module.exports = { Order, initOrder };
