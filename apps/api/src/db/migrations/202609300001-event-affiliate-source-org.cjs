'use strict';

module.exports = {
  async up(q, S) {
    return q.sequelize.transaction(async (transaction) => {
      await q.addColumn('event_affiliates', 'source_org_affiliate_id', {
        type: S.UUID, allowNull: true,
        references: { model: 'org_affiliates', key: 'id' }, onDelete: 'RESTRICT',
      }, { transaction });
      await q.addIndex('event_affiliates', ['source_org_affiliate_id'], { transaction });
      await q.sequelize.query(`
      WITH detached AS (
        SELECT DISTINCT ON (a.entity_id) a.entity_id AS event_affiliate_id,
          (a.before->>'orgAffiliateId')::uuid AS org_affiliate_id
        FROM audit_logs a
        JOIN event_affiliates ea ON ea.id = a.entity_id
        JOIN events e ON e.id = ea.event_id
        JOIN org_affiliates oa ON oa.id = (a.before->>'orgAffiliateId')::uuid
        WHERE a.entity_type = 'EventAffiliate'
          AND a.action IN ('event.referrer.updated', 'event.referrer.organization_scope_detached')
          AND a.before->>'orgAffiliateId' IS NOT NULL
          AND jsonb_exists(a.after, 'orgAffiliateId')
          AND a.after->>'orgAffiliateId' IS NULL
          AND ea.org_affiliate_id IS NULL
          AND oa.user_id = ea.user_id AND oa.organization_id = e.organization_id
        ORDER BY a.entity_id, a.created_at DESC, a.id DESC
      )
      UPDATE event_affiliates ea
      SET source_org_affiliate_id = detached.org_affiliate_id
      FROM detached
      WHERE ea.id = detached.event_affiliate_id AND ea.source_org_affiliate_id IS NULL
      `, { transaction });
    });
  },
  async down(q) {
    return q.sequelize.transaction(async (transaction) => {
      await q.removeIndex('event_affiliates', ['source_org_affiliate_id'], { transaction });
      await q.removeColumn('event_affiliates', 'source_org_affiliate_id', { transaction });
    });
  },
};
