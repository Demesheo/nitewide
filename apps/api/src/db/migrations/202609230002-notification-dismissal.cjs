module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('notifications', 'dismissed_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) { await queryInterface.removeColumn('notifications', 'dismissed_at'); },
};
