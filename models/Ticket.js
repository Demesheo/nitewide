import { Model, DataTypes } from 'sequelize';

export const TICKET_STATUS = ['active', 'cancelled', 'used'];

export default class Ticket extends Model {
  static initModel(sequelize) {
    Ticket.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      status: {
        type: DataTypes.ENUM(...TICKET_STATUS),
        defaultValue: 'active',
      },
      price: DataTypes.FLOAT,
    }, {
      sequelize,
      modelName: 'Ticket',
      timestamps: true,
      paranoid: true,
    });
  }
}
