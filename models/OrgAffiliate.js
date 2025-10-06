import { Model, DataTypes } from 'sequelize';

export default class OrgAffiliate extends Model {
  static initModel(sequelize) {
    OrgAffiliate.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
    }, {
      sequelize,
      modelName: 'OrgAffiliate',
      timestamps: true,
      paranoid: true,
    });
  }
}
