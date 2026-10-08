const { DataTypes, Model } = require('sequelize');
const { id } = require('./helpers');
class Rundown extends Model {}
function initRundown(sequelize) {
  Rundown.init({
    id: id(),
    userId: { type: DataTypes.UUID, allowNull: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { sequelize, modelName: 'Rundown', tableName: 'rundowns', indexes: [
    { unique: true, fields: ['user_id'] }, { unique: true, fields: ['organization_id'] },
  ], validate: { exactlyOneOwner() {
    if (Boolean(this.userId) === Boolean(this.organizationId)) throw new Error('A rundown requires exactly one owner');
  } } });
  return Rundown;
}
module.exports = { Rundown, initRundown };
