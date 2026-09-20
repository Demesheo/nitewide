const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class OrderItem extends Model {}
function initOrderItem(sequelize) {
  OrderItem.init({
    id: id(), orderId: { type: DataTypes.UUID, allowNull: false }, offeringId: { type: DataTypes.UUID, allowNull: false },
    nameSnapshot: { type: DataTypes.STRING(160), allowNull: false }, kindSnapshot: { type: DataTypes.STRING(40), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } }, entriesPerUnitSnapshot: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
    unitPriceCents: cents(false, 0), lineTotalCents: cents(false, 0),
  }, { sequelize, modelName: 'OrderItem', tableName: 'order_items', indexes: [{ fields: ['order_id'] }, { fields: ['offering_id'] }] });
  return OrderItem;
}
module.exports = { OrderItem, initOrderItem };

