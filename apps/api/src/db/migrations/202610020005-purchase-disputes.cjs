'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      await q.createTable('purchase_disputes', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        order_id: { type: S.UUID, allowNull: false, references: { model: 'orders', key: 'id' }, onDelete: 'RESTRICT' },
        stripe_dispute_id: { type: S.STRING(255), allowNull: false },
        stripe_account_id: { type: S.STRING(255), allowNull: false },
        provider_mode: { type: S.STRING(8), allowNull: false },
        status: { type: S.STRING(32), allowNull: false, defaultValue: 'unverified' },
        amount_cents: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        currency: { type: S.STRING(3), allowNull: false },
        observation_token: S.UUID, synchronized_at: S.DATE,
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex('purchase_disputes', ['stripe_account_id','provider_mode','stripe_dispute_id'], { unique: true, transaction });
      await q.addIndex('purchase_disputes', ['order_id','status'], { transaction });
      await q.sequelize.query(`ALTER TABLE purchase_disputes
        ADD CONSTRAINT purchase_dispute_mode CHECK(provider_mode='test'),
        ADD CONSTRAINT purchase_dispute_amount CHECK(amount_cents>=0),
        ADD CONSTRAINT purchase_dispute_status CHECK(status IN ('unverified','warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented'));`, { transaction });
    });
  },
  async down(q) { await q.dropTable('purchase_disputes'); },
};
