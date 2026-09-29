const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');

class SavedEvent extends Model {}

function initSavedEvent(sequelize) {
  SavedEvent.init({
    id: id(),
    userId: { type: DataTypes.UUID, allowNull: false },
    eventId: { type: DataTypes.UUID, allowNull: false },
  }, { sequelize, modelName: 'SavedEvent', tableName: 'saved_events', indexes: [
    { unique: true, fields: ['user_id', 'event_id'] },
    { fields: ['user_id', 'created_at', 'id'] },
  ] });
  return SavedEvent;
}

module.exports = { SavedEvent, initSavedEvent };
