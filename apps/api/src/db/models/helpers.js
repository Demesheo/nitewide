const { DataTypes } = require('sequelize');

const id = () => ({ type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true });
const cents = (allowNull = false, defaultValue) => ({
  type: DataTypes.INTEGER,
  allowNull,
  ...(defaultValue === undefined ? {} : { defaultValue }),
  validate: { min: 0 },
});
const basisPoints = (allowNull = false, defaultValue) => ({
  type: DataTypes.INTEGER,
  allowNull,
  ...(defaultValue === undefined ? {} : { defaultValue }),
  validate: { min: 0, max: 10_000 },
});

module.exports = { id, cents, basisPoints };

