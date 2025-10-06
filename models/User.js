import { Model, DataTypes } from 'sequelize';
import bcrypt from 'bcrypt';

export default class User extends Model {
  static initModel(sequelize) {
    User.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      phoneNumber: {
        type: DataTypes.STRING,
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      isAdmin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    }, {
      sequelize,
      modelName: 'User',
      timestamps: true,
      paranoid: true,
    });
  }

  async setPassword(password) {
    this.passwordHash = await bcrypt.hash(password, 10);
  }

  async checkPassword(password) {
    return bcrypt.compare(password, this.passwordHash);
  }
}
