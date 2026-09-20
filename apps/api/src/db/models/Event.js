const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class Event extends Model {}
function initEvent(sequelize) {
  Event.init({
    id: id(),
    creatorUserId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    locationId: { type: DataTypes.UUID, allowNull: true },
    title: { type: DataTypes.STRING(180), allowNull: false },
    slug: { type: DataTypes.STRING(200), allowNull: false, validate: { is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ } },
    summary: DataTypes.STRING(500),
    description: DataTypes.TEXT,
    category: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'other' },
    status: { type: DataTypes.ENUM('draft', 'published', 'cancelled', 'completed'), allowNull: false, defaultValue: 'draft' },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    capacity: { type: DataTypes.INTEGER, validate: { min: 0 } },
    guestlistCapacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    isDiscoverable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    sequelize, modelName: 'Event', tableName: 'events', version: true,
    indexes: [{ unique: true, fields: ['organization_id', 'slug'] }, { fields: ['status', 'starts_at'] }, { fields: ['location_id', 'starts_at'] }],
    validate: { endsAfterStart() { if (this.endsAt <= this.startsAt) throw new Error('endsAt must be after startsAt'); } },
  });
  return Event;
}
module.exports = { Event, initEvent };

