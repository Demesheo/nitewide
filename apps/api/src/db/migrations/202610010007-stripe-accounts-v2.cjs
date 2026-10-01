'use strict';
module.exports = {
  async up(q,S) {
    await q.sequelize.transaction(async transaction => {
      await q.addColumn('payment_accounts','account_api_version',{type:S.STRING(8),allowNull:false,defaultValue:'v2'},{transaction});
      await q.sequelize.query(`UPDATE payment_accounts SET charges_enabled=false,payouts_enabled=false,details_submitted=false,card_payments_active=false,controller_matches=false,synchronized_at=NULL;
        ALTER TABLE payment_accounts ADD CONSTRAINT payment_accounts_api_v2 CHECK(account_api_version='v2')`,{transaction});
    });
  },
  async down() {throw new Error('Preserve account evidence and merchant history; revert through an explicit forward migration.');},
};
