'use strict';

module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async (transaction) => {
      await q.addColumn('event_affiliates', 'access_scope', { type: S.STRING(20), allowNull: true }, { transaction });
      await q.sequelize.query("ALTER TABLE event_affiliates ADD CONSTRAINT event_affiliates_access_scope_check CHECK (access_scope IN ('organization','event'))", { transaction });
      await q.sequelize.query(`UPDATE event_affiliates SET access_scope = CASE
        WHEN org_affiliate_id IS NOT NULL OR source_org_affiliate_id IS NOT NULL
          OR code LIKE 'STAFFEV-%' OR code LIKE 'LEADEV-%' THEN 'organization'
        ELSE 'event' END`, { transaction });
      // An accepted event invitation is an explicit event grant. Repair only
      // unambiguous legacy grants; a later organization-scope change wins.
      await q.sequelize.query(`WITH accepted AS (
        SELECT ea.id, oa.default_commission_bps, oa.default_guestlist_allocation,
          oa.starts_at AS org_starts_at, oa.ends_at AS org_ends_at
        FROM event_affiliates ea JOIN events e ON e.id = ea.event_id
        JOIN audit_logs grant_log ON grant_log.entity_type = 'EventAffiliate'
          AND grant_log.entity_id = ea.id AND grant_log.action = 'event.promoter.invitation_terms_accepted'
        LEFT JOIN org_affiliates oa ON oa.id = ea.org_affiliate_id
          AND oa.user_id = ea.user_id AND oa.organization_id = e.organization_id
        WHERE (ea.org_affiliate_id IS NULL OR oa.id IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM audit_logs later WHERE later.entity_type = 'EventAffiliate'
            AND later.entity_id = ea.id AND later.created_at > grant_log.created_at
            AND later.action IN ('event.referrer.organization_scope_detached', 'event.referrer.organization_scope_restored'))
      )
      UPDATE event_affiliates ea SET access_scope = 'event',
        commission_bps = COALESCE(ea.commission_bps, accepted.default_commission_bps, 0),
        guestlist_allocation = COALESCE(ea.guestlist_allocation, accepted.default_guestlist_allocation),
        starts_at = GREATEST(ea.starts_at, accepted.org_starts_at),
        ends_at = LEAST(ea.ends_at, accepted.org_ends_at),
        org_affiliate_id = NULL, source_org_affiliate_id = NULL
      FROM accepted WHERE ea.id = accepted.id`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('ALTER TABLE event_affiliates DROP CONSTRAINT event_affiliates_access_scope_check', { transaction });
      await q.removeColumn('event_affiliates', 'access_scope', { transaction });
    });
  },
};
