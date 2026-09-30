const { mutationTransaction } = require('./mutation-transaction');
const { QueryTypes } = require('sequelize');
const { conflict, forbidden } = require('../domain/errors');
const { assertEventEditable } = require('../domain/event-policy');
const { accessScopeSql } = require('./event-affiliate-access');

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
      const rows = await models.Event.sequelize.query(`INSERT INTO event_affiliates
        (id, event_id, user_id, org_affiliate_id, source_org_affiliate_id, access_scope, code, commission_bps, guestlist_allocation, starts_at, ends_at, status, created_at, updated_at)
        SELECT gen_random_uuid(), :targetEventId, source.user_id,
          CASE WHEN :sameOrganization THEN source.org_affiliate_id ELSE NULL END,
          source.source_org_affiliate_id, ${accessScopeSql('source')},
          'NW-' || gen_random_uuid()::text, source.commission_bps,
          CASE WHEN :copyAllocations THEN source.guestlist_allocation ELSE 0 END,
          NULL, NULL, 'active', NOW(), NOW()
        FROM event_affiliates source JOIN users recipient ON recipient.id = source.user_id
        JOIN events source_event ON source_event.id = source.event_id
        LEFT JOIN org_affiliates oa ON oa.id = source.org_affiliate_id
        WHERE source.event_id = :sourceEventId AND source.status = 'active'
          AND (${accessScopeSql('source')} = 'event' OR (source.code NOT LIKE 'STAFFEV-%' AND source.code NOT LIKE 'LEADEV-%')
            OR EXISTS (SELECT 1 FROM org_affiliates current_promoter WHERE current_promoter.organization_id = source_event.organization_id
              AND current_promoter.user_id = source.user_id AND current_promoter.status = 'active'
              AND (current_promoter.starts_at IS NULL OR current_promoter.starts_at <= NOW())
              AND (current_promoter.ends_at IS NULL OR current_promoter.ends_at >= NOW())))
          AND recipient.lifecycle_state = 'active' AND recipient.is_active = true AND recipient.onboarding_pending = false
          AND (source.org_affiliate_id IS NULL OR oa.status = 'active')
        ON CONFLICT (event_id, user_id) DO NOTHING RETURNING id`, {
        replacements: { targetEventId, sourceEventId, copyAllocations, sameOrganization: Boolean(source.organizationId) },
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
