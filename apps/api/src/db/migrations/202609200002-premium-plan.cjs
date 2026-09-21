'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_tier_check",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "UPDATE organizations SET plan_tier = 'premium' WHERE plan_tier = 'gold'",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE organizations ADD CONSTRAINT organizations_plan_tier_check CHECK (plan_tier IN ('free','premium'))",
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_tier_check",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "UPDATE organizations SET plan_tier = 'gold' WHERE plan_tier = 'premium'",
        { transaction },
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE organizations ADD CONSTRAINT organizations_plan_tier_check CHECK (plan_tier IN ('free','gold'))",
        { transaction },
      );
    });
  },
};
