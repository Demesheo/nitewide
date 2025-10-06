const sequelize = require('./config/database');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully!');
    process.exit();
  } catch (err) {
    console.error('Unable to connect to DB:', err);
    process.exit(1);
  }
})();