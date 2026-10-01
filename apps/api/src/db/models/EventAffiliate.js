const { DataTypes, Model } = require('sequelize');
const { id, basisPoints } = require('./helpers');
class EventAffiliate extends Model {}
function initEventAffiliate(sequelize) {
  EventAffiliate.init({
    id: id(), eventId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false }, orgAffiliateId: DataTypes.UUID, sourceOrgAffiliateId: DataTypes.UUID,
    accessScope: { type: DataTypes.STRING(20), allowNull: true, validate: { isIn: [['organization', 'event', 'venue']] } },
    venueAccessId: DataTypes.UUID,
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    code: { type: DataTypes.STRING(48), allowNull: false, unique: true },
    commissionBps: basisPoints(true),
    guestlistAllocation: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0 } },
    startsAt: DataTypes.DATE, endsAt: DataTypes.DATE,
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
  }, { sequelize, version: true, modelName: 'EventAffiliate', tableName: 'event_affiliates', indexes: [{ unique: true, fields: ['event_id', 'user_id'] }] });
  return EventAffiliate;
}
module.exports = { EventAffiliate, initEventAffiliate };
