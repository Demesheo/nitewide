const { DataTypes: S } = require('sequelize');

module.exports = {
  async up(q) {
    await q.addColumn('users', 'notification_preferences', {
      type: S.JSONB, allowNull: false,
      defaultValue: { reviewRequests: true, salesActivity: true, inventoryAlerts: true },
    });
  },
  async down(q) { await q.removeColumn('users', 'notification_preferences'); },
};
