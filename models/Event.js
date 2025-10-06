import { Model, DataTypes } from 'sequelize';

export default class Event extends Model {
  static initModel(sequelize) {
    Event.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: DataTypes.TEXT,
      startTime: {
        type: DataTypes.BIGINT, // Unix timestamp
        allowNull: false,
      },
      endTime: {
        type: DataTypes.BIGINT, // Unix timestamp
        allowNull: false,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: true, // optional, supports events without org
      },
      streetAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      zip: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      metroArea: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      private: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    }, {
      sequelize,
      modelName: 'Event',
      timestamps: true,
      paranoid: true,
    });
  }
}
