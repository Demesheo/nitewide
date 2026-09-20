const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Order extends Model {}
function initOrder(sequelize) {
  Order.init({
    id: id(), buyerUserId: { type: DataTypes.UUID, allowNull: false }, eventId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'paid', 'cancelled', 'refunded'), allowNull: false, defaultValue: 'pending' },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    subtotalCents: cents(false, 0), platformFeeCents: cents(false, 0), totalCents: cents(false, 0), affiliateCommissionCents: cents(false, 0),
    orgAffiliateId: DataTypes.UUID, eventAffiliateId: DataTypes.UUID,
    pricingPlanSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false }, paidAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Order', tableName: 'orders', indexes: [{ unique: true, fields: ['buyer_user_id', 'idempotency_key'] }, { fields: ['event_id', 'status', 'created_at'] }] });
  return Order;
}
module.exports = { Order, initOrder };

