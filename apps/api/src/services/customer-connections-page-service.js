const { Op, QueryTypes } = require('sequelize');
const { createReferralLinkService } = require('./referral-link-service');
const { publicEvent } = require('../controllers/public-controller');
const { accessScopeSql } = require('./event-affiliate-access');

// Aggregate the customer's historical attribution in SQL. Loading every order
// and invitation into Node made Connections grow with transaction volume.
const connectedCte = `WITH connected AS (
  SELECT eaff.user_id AS referrer_id, ord.event_id, 'purchase' AS kind, COALESCE(ord.paid_at,ord.created_at) AS connected_at
    FROM orders ord JOIN event_affiliates eaff ON eaff.id=ord.event_affiliate_id
    WHERE ord.buyer_user_id=:userId AND ord.status='paid'
  UNION ALL
  SELECT oaff.user_id, ord.event_id, 'purchase', COALESCE(ord.paid_at,ord.created_at)
    FROM orders ord JOIN org_affiliates oaff ON oaff.id=ord.org_affiliate_id
    WHERE ord.buyer_user_id=:userId AND ord.status='paid' AND ord.event_affiliate_id IS NULL
  UNION ALL
  SELECT eaff.user_id, guest.event_id, 'guestlist', guest.created_at
    FROM guestlist_entries guest JOIN event_affiliates eaff ON eaff.id=guest.event_affiliate_id
    WHERE guest.user_id=:userId
  UNION ALL
  SELECT invite.invited_by_user_id, invite.event_id, 'guestlist', invite.accepted_at
    FROM guestlist_invitations invite
    WHERE invite.accepted_by_user_id=:userId AND invite.status='accepted'
), people AS (
  SELECT referrer_id,
    COUNT(*) FILTER (WHERE kind='purchase')::int AS bookings,
    COUNT(DISTINCT event_id) FILTER (WHERE kind='guestlist')::int AS guestlist_events,
    COUNT(DISTINCT event_id)::int AS connected_events,
    MAX(connected_at) AS last_connected_at
  FROM connected WHERE referrer_id<>:userId GROUP BY referrer_id
)
`;

async function connectionHistorySql(models, userId, { page = 1, pageSize = 20, search = '' } = {}) {
  const scope = `FROM people JOIN users person ON person.id=people.referrer_id
    WHERE person.is_active=true AND person.lifecycle_state='active' AND person.onboarding_pending=false
      AND (:search = '' OR person.display_name ILIKE :searchPattern ESCAPE '!')`;
  const replacements = { userId, pageSize, offset: (page - 1) * pageSize,
    search, searchPattern: `%${search.replace(/[!%_]/g, '!$&')}%` };
  const [counts] = await models.Order.sequelize.query(`${connectedCte}
    SELECT (SELECT EXISTS(SELECT 1 FROM people)) AS eligible, COUNT(*)::int AS total ${scope}`,
  { replacements, type: QueryTypes.SELECT });
  const rows = await models.Order.sequelize.query(`${connectedCte}
    SELECT people.*, person.display_name AS name ${scope}
    ORDER BY person.display_name ASC, people.referrer_id ASC LIMIT :pageSize OFFSET :offset`,
  { replacements, type: QueryTypes.SELECT });
  return { eligible: counts.eligible, people: rows.map((row) => ({ id: row.referrer_id, name: row.name, bookings: row.bookings,
      guestlistEvents: row.guestlist_events, connectedEvents: row.connected_events,
      lastConnectedAt: row.last_connected_at ? new Date(row.last_connected_at).toISOString() : null })),
    page, pageSize, total: counts.total, hasMore: page * pageSize < counts.total };
}

async function pagedConnections({ models, userId, eventId = null, page = 1, pageSize = 9, city = '', query = '', personIds = [], now = () => new Date(), referralLinks }) {
  const currentMember = `(
    EXISTS (SELECT 1 FROM organization_owners owner WHERE owner.organization_id=event.organization_id AND owner.user_id=person.id AND owner.lifecycle_state='active')
    OR EXISTS (SELECT 1 FROM organization_employees employee WHERE employee.organization_id=event.organization_id AND employee.user_id=person.id AND employee.status='active')
    OR EXISTS (SELECT 1 FROM org_affiliates org_ref WHERE org_ref.organization_id=event.organization_id AND org_ref.user_id=person.id AND org_ref.status='active'
      AND (org_ref.starts_at IS NULL OR org_ref.starts_at<=:now) AND (org_ref.ends_at IS NULL OR org_ref.ends_at>=:now))
  )`;
  const scope = `FROM events event
    JOIN people connection ON TRUE
    JOIN users person ON person.id=connection.referrer_id
    LEFT JOIN organizations org ON org.id=event.organization_id
    LEFT JOIN locations venue ON venue.id=event.location_id
    LEFT JOIN users creator ON creator.id=event.creator_user_id
    WHERE event.status='published' AND event.lifecycle_state='active' AND event.is_discoverable=true
      AND event.starts_at>:now
      AND (:eventId IS NULL OR event.id=CAST(:eventId AS uuid))
      AND person.is_active=true AND person.lifecycle_state='active' AND person.onboarding_pending=false
      ${personIds.length ? 'AND person.id IN (:personIds)' : ''}
      AND (:city = '' OR venue.city ILIKE :cityPattern ESCAPE '!')
      AND (:query = '' OR concat_ws(' ',event.title,event.summary,event.category,org.name,venue.name,venue.city,person.display_name) ILIKE :queryPattern ESCAPE '!')
      AND (event.organization_id IS NULL OR (org.status='active' AND org.lifecycle_state='active'))
      AND (event.location_id IS NULL OR venue.lifecycle_state='active')
      AND (event.organization_id IS NOT NULL OR (creator.is_active=true AND creator.lifecycle_state='active' AND creator.onboarding_pending=false))
      AND NOT EXISTS (SELECT 1 FROM event_affiliates blocked WHERE blocked.event_id=event.id AND blocked.user_id=person.id AND blocked.status='inactive')
      AND NOT EXISTS (SELECT 1 FROM event_affiliates expired WHERE expired.event_id=event.id AND expired.user_id=person.id
        AND expired.status='active' AND ((expired.starts_at IS NOT NULL AND expired.starts_at>:now)
          OR (expired.ends_at IS NOT NULL AND expired.ends_at < :now)))
      AND NOT EXISTS (SELECT 1 FROM event_affiliates assigned JOIN org_affiliates source ON source.id=assigned.org_affiliate_id
        WHERE assigned.event_id=event.id AND assigned.user_id=person.id
          AND (source.status<>'active' OR (source.starts_at IS NOT NULL AND source.starts_at > :now)
            OR (source.ends_at IS NOT NULL AND source.ends_at < :now)))
      AND NOT EXISTS (SELECT 1 FROM event_affiliates assigned WHERE assigned.event_id=event.id AND assigned.user_id=person.id
        AND ${accessScopeSql('assigned')}='organization' AND NOT ${currentMember})
      AND (
        ${currentMember}
        OR EXISTS (SELECT 1 FROM event_affiliates event_ref WHERE event_ref.event_id=event.id AND event_ref.user_id=person.id AND event_ref.status='active'
          AND (${accessScopeSql('event_ref')}='event' OR ${currentMember})
          AND (event_ref.starts_at IS NULL OR event_ref.starts_at<=:now) AND (event_ref.ends_at IS NULL OR event_ref.ends_at>=:now))
        OR (event.organization_id IS NULL AND event.creator_user_id=person.id)
      )`;
  const replacements = { userId, eventId, personIds, now: now(), pageSize, offset: (page - 1) * pageSize,
    city, cityPattern: `%${city.split(',')[0].trim().replace(/[!%_]/g, '!$&')}%`,
    query, queryPattern: `%${query.replace(/[!%_]/g, '!$&')}%` };
  const [countRow] = await models.Event.sequelize.query(`${connectedCte} SELECT COUNT(*)::int AS total ${scope}`, { replacements, type: QueryTypes.SELECT });
  const candidates = await models.Event.sequelize.query(`${connectedCte} SELECT event.id AS event_id, person.id AS referrer_id, person.display_name AS referrer_name ${scope}
    ORDER BY event.starts_at ASC, event.id ASC, person.display_name ASC, person.id ASC
    LIMIT :pageSize OFFSET :offset`, { replacements, type: QueryTypes.SELECT });
  const eventIds = [...new Set(candidates.map((row) => row.event_id))];
  const events = eventIds.length ? await models.Event.findAll({ where: { id: { [Op.in]: eventIds } }, include: [
    { model: models.Location, as: 'location' },
    { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
    { model: models.Offering, as: 'offerings', required: false },
  ] }) : [];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const links = referralLinks || createReferralLinkService({ models, now });
  const items = [];
  for (const candidate of candidates) {
    const event = eventById.get(candidate.event_id);
    if (!event) continue;
    try {
      const link = await links.ownLink(candidate.referrer_id, event.id);
      items.push({ event: publicEvent(event), referrer: { id: candidate.referrer_id, name: candidate.referrer_name }, code: link.code });
    } catch (error) {
      if (![403, 404, 409].includes(error.status) && error.code !== 'INVALID_AFFILIATE') throw error;
    }
  }
  return { items, page, pageSize, total: countRow.total, hasMore: page * pageSize < countRow.total };
}

module.exports = { connectionHistorySql, pagedConnections };
