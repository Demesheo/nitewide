import { Model, DataTypes } from 'sequelize';

export default class EventAffiliate extends Model {
  static initModel(sequelize) {
    EventAffiliate.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
    }, {
      sequelize,
      modelName: 'EventAffiliate',
      timestamps: true,
      paranoid: true,
    });
  }
}
