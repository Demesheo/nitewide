// config/database.js
import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

dotenv.config();

const sequelize = new Sequelize(
  process.env.DB_NAME,    // must be defined
  process.env.DB_USER,    // must be defined
  process.env.DB_PASS,    // must be defined
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    dialect: process.env.DB_DIALECT || 'postgres',
    logging: false,
  }
);

export default sequelize;
