const { offeringSaleState, eventFinished } = require('../domain/event-policy');
const { Op, QueryTypes } = require('sequelize');
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { assertActiveEvent } = require('../services/lifecycle-service');
const discoveryQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(100),
  cursor: z.string().max(1000).optional(),
  city: z.string().trim().max(120).default(''),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  query: z.string().trim().max(120).default(''),
  category: z.string().trim().max(80).default('all'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
}).refine((value) => value.startDate <= value.endDate, { path: ['endDate'], message: 'End date must be on or after start date' })
  .refine((value) => (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 <= 31,
    { path: ['endDate'], message: 'Discovery range must be 31 days or less' });
const cursorSchema = z.object({ day: z.iso.date(), premium: z.boolean(), title: z.string(), id: z.uuid(), filter: z.string().length(64) }).strict();
const discoveryFilterKey = (input) => createHash('sha256').update(JSON.stringify([input.city, input.startDate, input.endDate, input.query, input.category, input.timezone])).digest('hex');
function decodeCursor(value, filter) {
  if (!value) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.filter !== filter) throw new Error('Cursor does not match filters');
    return cursor;
  } catch { throw new (require('../domain/errors').DomainError)('Invalid discovery cursor', { code: 'VALIDATION_ERROR', status: 422 }); }
}
async function pagedEvents(models, input) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }); }
  catch { throw new (require('../domain/errors').DomainError)('Invalid discovery timezone', { code: 'VALIDATION_ERROR', status: 422 }); }
  const filter = discoveryFilterKey(input);
  const cursor = decodeCursor(input.cursor, filter);
  const replacements = {
    pageSize: input.pageSize + 1,
    city: `%${input.city.split(',')[0].trim().replace(/[\\%_]/g, '\\$&')}%`,
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: input.timezone,
    cursorDay: cursor?.day || null,
    cursorPremium: cursor?.premium ?? null,
    cursorTitle: cursor?.title || null,
    cursorId: cursor?.id || null,
  };
  const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const wordPredicates = words.map((word, index) => {
    replacements[`word${index}`] = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
    return `searchable.text ILIKE :word${index} ESCAPE '\\'`;
  });
  const categoryPredicate = input.category === 'all' ? '' : input.category === 'vip'
    ? "AND EXISTS (SELECT 1 FROM offerings offer WHERE offer.event_id=e.id AND offer.is_active=true AND offer.visibility='public' AND offer.kind IN ('package','reservation'))"
    : input.category === 'guestlist' ? 'AND e.guestlist_capacity > 0'
      : input.category === 'music' ? "AND searchable.text ~* 'music|concert|dj|live'"
        : 'AND e.category=:category';
  if (categoryPredicate === 'AND e.category=:category') replacements.category = input.category;
  const ids = await models.Event.sequelize.query(`
    SELECT e.id, sort."day", sort."premium", e.title
    FROM events e
    LEFT JOIN organizations org ON org.id=e.organization_id
    LEFT JOIN locations loc ON loc.id=e.location_id
    LEFT JOIN users creator ON creator.id=e.creator_user_id
    CROSS JOIN LATERAL (SELECT concat_ws(' ', e.title, e.description, e.summary, org.name,
      loc.name, loc.city, loc.region, e.category,
      (SELECT string_agg(concat_ws(' ', offer.name, offer.description), ' ') FROM offerings offer
        WHERE offer.event_id=e.id AND offer.is_active=true AND offer.visibility='public')) AS text) searchable
    CROSS JOIN LATERAL (SELECT
      to_char(e.starts_at AT TIME ZONE COALESCE(NULLIF(loc.timezone,''),:timezone), 'YYYY-MM-DD') AS "day",
      (org.plan_tier='premium') IS TRUE AS "premium") sort
    WHERE e.status='published' AND e.lifecycle_state='active' AND e.is_discoverable=true
      AND e.ends_at >= NOW()
      AND (e.organization_id IS NULL OR (org.lifecycle_state='active' AND org.status='active'))
      AND (e.location_id IS NULL OR loc.lifecycle_state='active')
      AND (e.organization_id IS NOT NULL OR (creator.lifecycle_state='active' AND creator.is_active=true AND creator.onboarding_pending=false))
      AND e.starts_at >= (CAST(:startDate AS date) - INTERVAL '14 hours')
      AND e.starts_at < (CAST(:endDate AS date) + INTERVAL '36 hours')
      AND sort."day" BETWEEN :startDate AND :endDate
      AND (CAST(:city AS text) = '%%' OR COALESCE(loc.city,'Private location') ILIKE :city ESCAPE '\\')
      ${wordPredicates.length ? `AND ${wordPredicates.join(' AND ')}` : ''}
      ${categoryPredicate}
      AND (:cursorDay IS NULL OR sort."day" > :cursorDay
        OR (sort."day" = :cursorDay AND sort."premium" < CAST(:cursorPremium AS boolean))
        OR (sort."day" = :cursorDay AND sort."premium" = CAST(:cursorPremium AS boolean) AND e.title COLLATE discovery_en_numeric > CAST(:cursorTitle AS text) COLLATE discovery_en_numeric)
        OR (sort."day" = :cursorDay AND sort."premium" = CAST(:cursorPremium AS boolean) AND e.title COLLATE discovery_en_numeric = CAST(:cursorTitle AS text) COLLATE discovery_en_numeric AND e.id > CAST(:cursorId AS uuid)))
    ORDER BY sort."day" ASC,sort."premium" DESC,e.title COLLATE discovery_en_numeric ASC,e.id ASC LIMIT :pageSize
  `, { replacements, type: QueryTypes.SELECT });
  const page = ids.slice(0, input.pageSize);
  const events = page.length ? await models.Event.findAll({ where: { id: page.map((row) => row.id) }, include: [
    { model: models.Location, as: 'location' },
    { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
    { model: models.Offering, as: 'offerings', required: false },
  ] }) : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const last = page.at(-1);
  return {
    items: page.map((row) => byId.get(row.id)).filter(Boolean).map(publicEvent),
    hasMore: ids.length > input.pageSize,
    nextCursor: ids.length > input.pageSize && last ? Buffer.from(JSON.stringify({ day: last.day, premium: last.premium, title: last.title, id: last.id, filter })).toString('base64url') : null,
  };
}
function publicEvent(event) {
  const json = event.toJSON();
  const offerings = event.offerings || [];
  return { ...json, isPremiumHost: event.organization?.planTier === 'premium', location: redactLocation(event.location), offerings: offerings.filter((o) => o.isActive && o.visibility === 'public').map((o) => {
    const { accessCodeHash, ...tier } = o.toJSON();
    return { ...tier, saleState: eventFinished(event) ? 'closed' : offeringSaleState(o, offerings) };
  }) };
}
function redactLocation(location) {
  if (!location) return null; const json = location.toJSON();
  if (json.privacy !== 'public') { delete json.addressLine1; delete json.addressLine2; delete json.postalCode; delete json.latitude; delete json.longitude; delete json.geo; }
  return json;
}
function createPublicController({ models }) {
  return {
    batchEvents: async (req, res) => {
      const ids = z.string().min(1).max(1200).transform((value) => value.split(',')).pipe(z.array(z.uuid()).min(1).max(30)).parse(req.query.ids);
      const unique = [...new Set(ids)];
      const events = await models.Event.findAll({ where: { id: { [Op.in]: unique }, status: 'published', lifecycleState: 'active', endsAt: { [Op.gte]: new Date() } },
        include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] },
          { model: models.Offering, as: 'offerings', required: false }] });
      const allowed = [];
      for (const event of events) {
        try { await assertActiveEvent(models, event); allowed.push(event); }
        catch (error) { if (![403, 404].includes(error.status)) throw error; }
      }
      const byId = new Map(allowed.map((event) => [event.id, event]));
      res.json({ data: { items: unique.map((id) => byId.get(id)).filter(Boolean).map(publicEvent) } });
    },
    listEvents: async (req, res) => {
      // Existing callers receive an array. Opt-in discovery callers receive a page.
      if (req.query.pageSize !== undefined) return res.json({ data: await pagedEvents(models, discoveryQuery.parse(req.query)) });
      // Apply the active-event boundary before pagination. Otherwise historical
      // events can consume the public limit and leave discovery with no results.
      const where = {
        status: 'published',
        lifecycleState: 'active',
        [Op.and]: [
          { [Op.or]: [{ organizationId: null }, { '$organization.lifecycle_state$': 'active', '$organization.status$': 'active' }] },
          { [Op.or]: [{ locationId: null }, { '$location.lifecycle_state$': 'active' }] },
          { [Op.or]: [{ organizationId: { [Op.ne]: null } }, { '$creator.lifecycle_state$': 'active', '$creator.is_active$': true, '$creator.onboarding_pending$': false }] },
        ],
        isDiscoverable: true,
        endsAt: { [Op.gte]: new Date() },
      };
      if (req.query.category) where.category = req.query.category;
      const candidates = await models.Event.findAll({ where, attributes: ['id'], include: [{ model: models.Location, as: 'location', attributes: [] }, { model: models.Organization, as: 'organization', attributes: ['id', 'planTier'] }, { model: models.User, as: 'creator', attributes: [] }], order: [['startsAt', 'ASC']], limit: Math.min(Number(req.query.limit) || 50, 100), subQuery: false });
      const events = candidates.length ? await models.Event.findAll({ where: { id: candidates.map((event) => event.id) }, include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] }, { model: models.Offering, as: 'offerings', required: false }], order: [['startsAt', 'ASC']] }) : [];
      res.json({ data: events.map(publicEvent) });
    },
    getEvent: async (req, res) => {
      const event = await models.Event.findByPk(req.params.eventId, { include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] }, { model: models.Offering, as: 'offerings', required: false }] });
      if (!event || event.status !== 'published') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found' } });
      try { await assertActiveEvent(models, event); } catch { return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found' } }); }
      res.json({ data: publicEvent(event) });
    },
  };
}
module.exports = { createPublicController, publicEvent, redactLocation };
