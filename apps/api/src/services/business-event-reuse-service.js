const { mutationTransaction } = require('./mutation-transaction');
const { QueryTypes } = require('sequelize');
const { conflict, forbidden } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');
const { accessScopeSql } = require('./event-affiliate-access');
const { assertCommissionPricing } = require('../domain/editor-pricing-policy');

function createBusinessEventReuseService({ models, permissions, now = () => new Date() }) {
  async function copyAccess(userId, targetEventId, { sourceEventId, copyTeam, copyAllocations }) {
    if (!copyTeam) throw conflict('Choose team copying explicitly');
    return mutationTransaction(models.Event.sequelize, async (transaction) => {
    const source = await permissions.assertManageEvent(userId, sourceEventId, transaction);
    const target = await permissions.assertManageEvent(userId, targetEventId, transaction);
    if (source.id === target.id) throw conflict('Choose a different source event');
    if (source.organizationId !== target.organizationId ||
      (!source.organizationId && source.creatorUserId !== target.creatorUserId)) throw forbidden('Only events in the same managed workspace can share team assignments');
      const current = await models.Event.findByPk(targetEventId, { transaction, lock: transaction.LOCK.UPDATE });
      assertEventEditable(current, now());
      if (current.status !== 'draft') throw conflict('Team copying is only available for a new draft');
      const [orders, guests] = await Promise.all([
        models.Order.count({ where: { eventId: targetEventId }, transaction }),
        models.GuestlistEntry.count({ where: { eventId: targetEventId }, transaction }),
      ]);
      if (orders || guests) throw conflict('This draft already has activity and cannot receive copied assignments');
      // A detached former promoter remains tied to its old organization scope
      // so a later team removal also revokes the copied event assignment.
      const replacements = { targetEventId,sourceEventId,copyAllocations,sameOrganization:Boolean(source.organizationId),targetOrganizationId:current.organizationId || null,targetLocationId:current.locationId || null,now:now() };
      const eligible = `FROM event_affiliates source JOIN users recipient ON recipient.id = source.user_id
        JOIN events source_event ON source_event.id = source.event_id
        LEFT JOIN org_affiliates oa ON oa.id = source.org_affiliate_id
        WHERE source.event_id = :sourceEventId AND source.status = 'active'
          AND (source.starts_at IS NULL OR source.starts_at <= :now) AND (source.ends_at IS NULL OR source.ends_at >= :now)
          AND (${accessScopeSql('source')} <> 'venue' OR (source_event.organization_id = :targetOrganizationId AND source_event.location_id = :targetLocationId
            AND EXISTS (SELECT 1 FROM venue_access current_venue
              JOIN organization_venues venue_parent ON venue_parent.organization_id=current_venue.organization_id AND venue_parent.location_id=current_venue.location_id
              JOIN organizations venue_business ON venue_business.id=current_venue.organization_id
              JOIN locations venue_location ON venue_location.id=current_venue.location_id
              WHERE current_venue.id=source.venue_access_id AND current_venue.user_id=source.user_id AND current_venue.status='active'
                AND current_venue.organization_id=source_event.organization_id AND current_venue.location_id=source_event.location_id
                AND venue_business.lifecycle_state='active' AND venue_business.status='active' AND venue_location.lifecycle_state='active')))
          AND (${accessScopeSql('source')} = 'event' OR (source.code NOT LIKE 'STAFFEV-%' AND source.code NOT LIKE 'LEADEV-%')
            OR EXISTS (SELECT 1 FROM org_affiliates current_promoter WHERE current_promoter.organization_id = source_event.organization_id
              AND current_promoter.user_id = source.user_id AND current_promoter.status = 'active'
              AND (current_promoter.starts_at IS NULL OR current_promoter.starts_at <= :now)
              AND (current_promoter.ends_at IS NULL OR current_promoter.ends_at >= :now)))
          AND recipient.lifecycle_state = 'active' AND recipient.is_active = true AND recipient.onboarding_pending = false
          AND (source.org_affiliate_id IS NULL OR (oa.status = 'active' AND (oa.starts_at IS NULL OR oa.starts_at <= :now) AND (oa.ends_at IS NULL OR oa.ends_at >= :now)))
          AND NOT EXISTS (SELECT 1 FROM event_affiliates existing WHERE existing.event_id=:targetEventId AND existing.user_id=source.user_id)`;
      const [terms] = await models.Event.sequelize.query(`SELECT COALESCE(MAX(COALESCE(source.commission_bps,oa.default_commission_bps,0)),0)::integer AS "commissionBps" ${eligible}`,
        {replacements,type:QueryTypes.SELECT,transaction});
      if (models.Offering) await assertCommissionPricing({models,eventId:targetEventId,commissionBps:Number(terms.commissionBps),transaction,now:replacements.now});
      const rows = await models.Event.sequelize.query(`INSERT INTO event_affiliates
        (id, event_id, user_id, org_affiliate_id, source_org_affiliate_id, access_scope, venue_access_id, code, commission_bps, guestlist_allocation, starts_at, ends_at, status, created_at, updated_at)
        SELECT gen_random_uuid(), :targetEventId, source.user_id,
          CASE WHEN :sameOrganization THEN source.org_affiliate_id ELSE NULL END,
          source.source_org_affiliate_id, ${accessScopeSql('source')}, CASE WHEN ${accessScopeSql('source')} = 'venue' THEN source.venue_access_id ELSE NULL END,
          'NW-' || gen_random_uuid()::text, source.commission_bps,
          CASE WHEN :copyAllocations THEN source.guestlist_allocation ELSE 0 END,
          NULL, NULL, 'active', NOW(), NOW()
        ${eligible}
        ON CONFLICT (event_id, user_id) DO NOTHING RETURNING id`, {
        replacements,
        type: QueryTypes.SELECT, transaction,
      });
      await models.AuditLog.create({ actorUserId: userId, organizationId: target.organizationId,
        entityType: 'Event', entityId: targetEventId, action: 'event.team_copied',
        after: { sourceEventId, copyTeam: true, copyAllocations, newAssignments: rows.length } }, { transaction });
      return { eventId: targetEventId, copied: rows.length, copyAllocations };
    }, { accessChange: true });
  }
  return { copyAccess };
}

module.exports = { createBusinessEventReuseService };
