const { Op, QueryTypes } = require('sequelize');
const { forbidden } = require('../domain/errors');
const { ADMISSION_WINDOW_MS, assertAdmissionOpen } = require('../domain/admission-policy');
const { orderAdmissionSql } = require('../domain/order-admission-policy');
const { activeEventScope, activeUser } = require('./lifecycle-service');
const { hasInternalPermission } = require('./internal-admin-permissions');
const { activeEventAffiliates } = require('./event-affiliate-scope');

function createAdmissionsService({ models: m, permissions, now = () => new Date() }) {
  async function events(userId, { page = 1, pageSize = 20, search = '' } = {}) {
    const user = await m.User.findByPk(userId);
    if (!activeUser(user)) throw forbidden('An active account is required');
    const [leaders, employees, promoters, affiliates] = await Promise.all([
      m.OrganizationOwner.findAll({ where: { userId, lifecycleState: 'active' }, attributes: ['organizationId'] }),
      m.OrganizationEmployee.findAll({ where: { userId, status: 'active' }, attributes: ['organizationId'] }),
      m.OrgAffiliate.findAll({ where: { userId, status: 'active' }, attributes: ['organizationId', 'startsAt', 'endsAt'] }),
      m.EventAffiliate.findAll({ where: { userId, status: 'active' }, attributes: ['eventId', 'userId', 'code', 'accessScope', 'orgAffiliateId', 'sourceOrgAffiliateId', 'venueAccessId', 'startsAt', 'endsAt'] }),
    ]);
    const orgIds = [...new Set([...leaders, ...employees].map((row) => row.organizationId))];
    const assignedIds = (await activeEventAffiliates(m, affiliates, leaders, employees, promoters)).map((a) => a.eventId);
    const venueGrants = m.VenueAccess ? await m.VenueAccess.findAll({ where: { userId, status: 'active' }, attributes: ['organizationId', 'locationId'] }) : [];
    const venueScopes = venueGrants.map((grant) => ({ organizationId: grant.organizationId, locationId: grant.locationId }));
    const time = now();
    const scope = activeEventScope(m, { locationAttributes: ['name', 'timezone', 'city'], admission: true });
    const where = { ...scope.where,
      status: 'published', startsAt: { [Op.lte]: new Date(+time + ADMISSION_WINDOW_MS) }, endsAt: { [Op.gte]: new Date(+time - ADMISSION_WINDOW_MS) },
      ...(!hasInternalPermission(user, 'events.manage') ? { [Op.or]: [{ organizationId: orgIds }, { organizationId: null, creatorUserId: userId }, { id: assignedIds }, ...venueScopes] } : {}),
    };
    if (search) where[Op.and] = [...scope.where[Op.and], { [Op.or]: [
      { title: { [Op.iLike]: `%${search.replace(/[\\%_]/g, '\\$&')}%` } },
      { '$location.name$': { [Op.iLike]: `%${search.replace(/[\\%_]/g, '\\$&')}%` } },
      { '$location.city$': { [Op.iLike]: `%${search.replace(/[\\%_]/g, '\\$&')}%` } },
    ] }];
    const result = await m.Event.findAndCountAll({ where, attributes: ['id', 'title', 'startsAt', 'endsAt', 'imageUrl'], include: scope.include, distinct: true, subQuery: false,
      order: [['startsAt', 'ASC'], ['id', 'ASC']], limit: pageSize, offset: (page - 1) * pageSize });
    const next = await m.Event.findOne({ where: { ...scope.where, status: 'published',
      startsAt: { [Op.gt]: new Date(+time + ADMISSION_WINDOW_MS) },
      ...(!hasInternalPermission(user, 'events.manage') ? { [Op.or]: [{ organizationId: orgIds }, { organizationId: null, creatorUserId: userId }, { id: assignedIds }, ...venueScopes] } : {}) },
      attributes: ['id', 'title', 'startsAt', 'endsAt'], include: scope.include,
      order: [['startsAt', 'ASC'], ['id', 'ASC']] });
    const nextEvent = next ? { ...next.toJSON(), unlockAt: new Date(+new Date(next.startsAt) - ADMISSION_WINDOW_MS) } : null;
    return { items: result.rows, events: result.rows, page, pageSize, total: result.count,
      hasMore: page * pageSize < result.count, serverTime: time, nextEvent };
  }
  async function roster(userId, eventId, { search = '', page = 1, status = 'all' } = {}) {
    const event = await permissions.assertAdmitEvent(userId, eventId);
    assertAdmissionOpen(event, now());
    // One snapshot for the roster and headcounts; no financial or QR secrets are
    // exposed to admissions staff. A guestlist pass represents its whole party.
    const [result] = await m.Event.sequelize.query(`WITH credentials AS (
      SELECT t.id, 'ticket' AS kind, u.display_name AS name, u.email,
        i.name_snapshot AS offering, 1 AS spots, t.status, t.checked_in_at AS "checkedInAt"
      FROM tickets t JOIN users u ON u.id = t.holder_user_id
      JOIN order_items i ON i.id = t.order_item_id JOIN orders o ON o.id = i.order_id
      WHERE t.event_id = :eventId AND ${orderAdmissionSql('o')} AND t.status IN ('valid', 'checked_in')
      UNION ALL
      SELECT g.id, 'guestlist', u.display_name, u.email, 'Guest list entry', g.party_size, g.status, g.checked_in_at
      FROM guestlist_entries g JOIN users u ON u.id = g.user_id
      WHERE g.event_id = :eventId AND g.status IN ('confirmed', 'checked_in')
    ), matched AS (
      SELECT * FROM credentials WHERE (:status = 'all' OR (:status = 'ready' AND status <> 'checked_in') OR (:status = 'admitted' AND status = 'checked_in'))
      AND (:search = '' OR name ILIKE :term OR email ILIKE :term OR id::text ILIKE :term)
    ) SELECT (SELECT COUNT(*)::int FROM matched) AS total,
      COALESCE((SELECT SUM(spots)::int FROM credentials), 0) AS expected,
      COALESCE((SELECT SUM(spots)::int FROM credentials WHERE status = 'checked_in'), 0) AS admitted,
      COALESCE((SELECT json_agg(p) FROM (SELECT * FROM matched ORDER BY lower(name), kind, id LIMIT 20 OFFSET :offset) p), '[]'::json) AS entries`,
    { replacements: { eventId, search, term: `%${search.replace(/[\\%_]/g, '\\$&')}%`, status, offset: (page - 1) * 20 }, type: QueryTypes.SELECT });
    return { ...result, page, pageSize: 20, serverTime: now() };
  }
  return { events, roster };
}
module.exports = { createAdmissionsService };
