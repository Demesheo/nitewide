'use strict';
module.exports = {
  async up(q,S) { await q.sequelize.transaction(async transaction => {
    await q.addColumn('events','fee_mode',{ type: S.STRING(16),allowNull: false,defaultValue: 'buyer' },{ transaction });
    await q.addColumn('offerings','fee_mode',{ type: S.STRING(16),allowNull: false,defaultValue: 'inherit' },{ transaction });
    await q.sequelize.query("ALTER TABLE events ADD CONSTRAINT event_fee_mode CHECK(fee_mode IN ('buyer','absorbed')); ALTER TABLE offerings ADD CONSTRAINT offering_fee_mode CHECK(fee_mode IN ('inherit','buyer','absorbed'));",{ transaction });
  }); },
  async down(q) { await q.sequelize.transaction(async transaction => {
    await q.removeColumn('offerings','fee_mode',{ transaction }); await q.removeColumn('events','fee_mode',{ transaction });
  }); },
};
