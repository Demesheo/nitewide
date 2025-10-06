import { Model, DataTypes } from 'sequelize';
import { User } from './index.js'; // make sure this import matches your models structure

export default class Guestlist extends Model {
  static initModel(sequelize) {
    Guestlist.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      notes: DataTypes.TEXT,
      userId: {
        type: DataTypes.UUID,
        allowNull: true, // optional, null for unregistered guests
        references: {
          model: User,
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    }, {
      sequelize,
      modelName: 'Guestlist',
      timestamps: true,
      paranoid: true,
    });
  }

  static associate(models) {
    // Optional association to User
    Guestlist.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}
