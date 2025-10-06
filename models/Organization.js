import { Model, DataTypes } from 'sequelize';

export default class Organization extends Model {
  static initModel(sequelize) {
    Organization.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: DataTypes.STRING,
      streetAddress: DataTypes.STRING,
      city: DataTypes.STRING,
      state: DataTypes.STRING,
      zip: DataTypes.STRING,
      metroArea: DataTypes.STRING,
      latitude: DataTypes.FLOAT,
      longitude: DataTypes.FLOAT,
      description: DataTypes.TEXT,
    }, {
      sequelize,
      modelName: 'Organization',
      timestamps: true,
      paranoid: true,
    });
  }
}
