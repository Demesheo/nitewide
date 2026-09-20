const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class Ticket extends Model {}
function initTicket(sequelize) {
  Ticket.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, orderItemId: { type: DataTypes.UUID, allowNull: false }, holderUserId: { type: DataTypes.UUID, allowNull: false },
    qrTokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    status: { type: DataTypes.ENUM('valid', 'checked_in', 'void', 'transferred'), allowNull: false, defaultValue: 'valid' },
    checkedInAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Ticket', tableName: 'tickets', indexes: [{ fields: ['event_id', 'holder_user_id'] }] });
  return Ticket;
}
module.exports = { Ticket, initTicket };

