const { DataTypes, Model } = require('sequelize');
const { id, cents } = require('./helpers');
class Boost extends Model {}
function initBoost(sequelize) {
  Boost.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, organizationId: DataTypes.UUID,
    status: { type: DataTypes.ENUM('draft', 'scheduled', 'active', 'completed', 'cancelled'), allowNull: false, defaultValue: 'draft' },
    startsAt: { type: DataTypes.DATE, allowNull: false }, endsAt: { type: DataTypes.DATE, allowNull: false }, budgetCents: cents(false), discountBpsSnapshot: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { sequelize, modelName: 'Boost', tableName: 'boosts' });
  return Boost;
}
module.exports = { Boost, initBoost };

