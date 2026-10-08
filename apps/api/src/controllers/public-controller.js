const { offeringSaleState, eventFinished } = require('../domain/event-policy');
const { Op, QueryTypes, literal } = require('sequelize');
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { assertActiveEvent } = require('../services/lifecycle-service');
const { discoveryQuery } = require('../http/public-schemas');
const { effectiveFeeMode } = require('@nitewide/pricing');
const { discoveryRegionAliases, normalizeDiscoveryText } = require('../../../shared/discovery-areas.mjs');
const { trustedLocationSql } = require('../domain/location-geography');
const cursorSchema = z.object({ day: z.iso.date(), premium: z.boolean(), title: z.string(), id: z.uuid(), filter: z.string().length(64) }).strict();
const discoveryFilterKey = (input, area) => createHash('sha256').update(JSON.stringify([
  input.allCities ? 'all-cities' : [area?.key || `unresolved:${normalizeDiscoveryText(input.city)}`, area?.kind, area?.version,
    area?.kind === 'radius' ? area.center : null, area?.kind === 'radius' ? area.radiusMeters : null],
  input.startDate, input.endDate, input.query, input.category, input.timezone])).digest('hex');
const normalizedTextSql = (column) => `regexp_replace(regexp_replace(lower(btrim(${column})), '[.''’]', '', 'g'), '[[:space:]_-]+', ' ', 'g')`;
function areaPredicate(input, area, alias = 'loc') {
  if (input.allCities) return 'TRUE';
  if (area.kind === 'radius') return `(${trustedLocationSql(alias)}) AND ST_DWithin(${alias}.geo,
    ST_SetSRID(ST_MakePoint(:areaLongitude,:areaLatitude),4326)::geography,:areaRadius)`;
  const memberPredicate = `(${normalizedTextSql(`${alias}.city`)},${normalizedTextSql(`${alias}.region`)},upper(btrim(${alias}.country_code))) IN
    (SELECT member.city,member.region,member.country FROM jsonb_to_recordset(CAST(:areaMembers AS jsonb)) AS member(city text,region text,country text))`;
  if (area.kind === 'metro' || area.kind === 'division') return `upper(btrim(${alias}.country_code))='US' AND (
    ((${trustedLocationSql(alias)}) AND ${alias}.county_fips IN (:areaCounties)) OR
    (NOT COALESCE((${trustedLocationSql(alias)}),false) AND ${memberPredicate}))`;
  return memberPredicate;
}
const eligibilityPredicate = `e.status='published' AND e.lifecycle_state='active' AND e.is_discoverable=true
  AND e.ends_at >= NOW()
  AND (e.organization_id IS NULL OR (org.lifecycle_state='active' AND org.status='active'))
  AND (e.location_id IS NULL OR loc.lifecycle_state='active')
  AND (e.organization_id IS NOT NULL OR (creator.lifecycle_state='active' AND creator.is_active=true AND creator.onboarding_pending=false))`;
function areaReplacements(area) {
  if (!area) return {};
  if (area.kind === 'radius') return { areaLatitude: area.center.latitude, areaLongitude: area.center.longitude, areaRadius: area.radiusMeters };
  const members = area.members?.length || area.kind !== 'city' && area.members ? area.members
    : (area.localities || [area.city]).map(city => ({ city, region: area.region, countryCode: area.countryCode }));
  return { areaMembers: JSON.stringify(members.flatMap(member => discoveryRegionAliases(member).map(region => ({ city: normalizeDiscoveryText(member.city), region, country: member.countryCode })))),
    ...(['metro', 'division'].includes(area.kind) ? { areaCounties: area.counties?.length ? area.counties : ['00000'] } : {}) };
}
function areaMetadata(area) {
  if (!area) return null;
  return { key: area.key, label: area.label, city: area.city, region: area.region, countryCode: area.countryCode, kind: area.kind || 'city',
    ...(area.groupLabel ? { groupLabel: area.groupLabel } : {}), ...(area.kind === 'radius' ? { radiusMiles: 30, centerLabel: area.label, geographyCoverage: 'verified-addresses-only' } : {}) };
}
function decodeCursor(value, filter) {
  if (!value) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.filter !== filter) throw new Error('Cursor does not match filters');
    return cursor;
  } catch { throw new (require('../domain/errors').DomainError)('Invalid discovery cursor', { code: 'VALIDATION_ERROR', status: 422 }); }
}
async function pagedEvents(models, input, catalog) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }); }
  catch { throw new (require('../domain/errors').DomainError)('Invalid discovery timezone', { code: 'VALIDATION_ERROR', status: 422 }); }
  const area = catalog.resolveNationalDiscoveryArea(input.city);
  const resolved = Boolean(input.allCities || area?.resolutionStatus === 'resolved');
  const metadata = { area: areaMetadata(area), hasUpcomingAreaEvents: resolved ? false : null, resolutionStatus: resolved ? 'resolved' : 'unresolved' };
  const filter = discoveryFilterKey(input, area);
  const cursor = decodeCursor(input.cursor, filter);
  if (!area && !input.allCities) return { items: [], hasMore: false, nextCursor: null, ...metadata };
  const replacements = {
    pageSize: input.pageSize + 1,
    ...areaReplacements(area),
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
    WHERE ${eligibilityPredicate}
      AND e.starts_at >= (CAST(:startDate AS date) - INTERVAL '14 hours')
      AND e.starts_at < (CAST(:endDate AS date) + INTERVAL '36 hours')
      AND sort."day" BETWEEN :startDate AND :endDate
      AND (${areaPredicate(input, area)})
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
  // EXISTS distinguishes an area awaiting its first event from a selected
  // date/search with no matches. Stop at the first eligible event; never COUNT
  // or hydrate an area's entire future catalog for this metadata.
  if (ids.length) metadata.hasUpcomingAreaEvents = true;
  else {
    const [availability] = await models.Event.sequelize.query(`SELECT EXISTS (
      SELECT 1 FROM events e
      LEFT JOIN organizations org ON org.id=e.organization_id
      LEFT JOIN locations loc ON loc.id=e.location_id
      LEFT JOIN users creator ON creator.id=e.creator_user_id
      WHERE ${eligibilityPredicate} AND (${areaPredicate(input, area)}) LIMIT 1
    ) AS "hasUpcomingAreaEvents"`, { replacements: areaReplacements(area), type: QueryTypes.SELECT });
    metadata.hasUpcomingAreaEvents = Boolean(availability?.hasUpcomingAreaEvents);
  }
  if (!metadata.hasUpcomingAreaEvents && !resolved) metadata.hasUpcomingAreaEvents = null;
  if (area?.kind === 'radius' && !metadata.hasUpcomingAreaEvents) {
    // Unknown venue points in an adjacent town can be inside this radius.
    // Private addresses intentionally remain unverified. Neither missing nor
    // failed geography is proof that this area has no upcoming events.
    const [coverage] = await models.Event.sequelize.query(`SELECT EXISTS (
      SELECT 1 FROM events e LEFT JOIN organizations org ON org.id=e.organization_id
      LEFT JOIN locations loc ON loc.id=e.location_id LEFT JOIN users creator ON creator.id=e.creator_user_id
      WHERE ${eligibilityPredicate} AND upper(btrim(loc.country_code))='US'
        AND NOT COALESCE((${trustedLocationSql('loc')}),false) LIMIT 1) AS incomplete`, { type: QueryTypes.SELECT });
    if (coverage?.incomplete) metadata.hasUpcomingAreaEvents = null;
  }
  return {
    items: page.map((row) => byId.get(row.id)).filter(Boolean).map(publicEvent),
    hasMore: ids.length > input.pageSize,
    nextCursor: ids.length > input.pageSize && last ? Buffer.from(JSON.stringify({ day: last.day, premium: last.premium, title: last.title, id: last.id, filter })).toString('base64url') : null,
    ...metadata,
  };
}
function publicEvent(event) {
  const json = event.toJSON();
  const offerings = event.offerings || [];
  return { ...json, isPremiumHost: event.organization?.planTier === 'premium', location: redactLocation(event.location), offerings: offerings.filter((o) => o.isActive && o.visibility === 'public').map((o) => {
    const { accessCodeHash, ...tier } = o.toJSON();
    return { ...tier, effectiveFeeMode: effectiveFeeMode(event.feeMode || 'buyer', o.feeMode || 'inherit'), saleState: eventFinished(event) ? 'closed' : offeringSaleState(o, offerings) };
  }) };
}
function redactLocation(location, { includeAttendeeAddress = false } = {}) {
  if (!location) return null; const json = location.toJSON();
  for (const key of ['countyFips', 'geocodeStatus', 'geocodeSource', 'geocodeAddressHash', 'geocodeBenchmark', 'geocodeVintage', 'geocodedAt', 'geocodeAttempts', 'geocodeNextAttemptAt']) delete json[key];
  if (json.privacy !== 'public' && !(json.privacy === 'attendees_only' && includeAttendeeAddress)) { delete json.addressLine1; delete json.addressLine2; delete json.postalCode; delete json.latitude; delete json.longitude; delete json.geo; }
  return json;
}
function createPublicController({ models, discoveryCatalog }) {
  const catalog = discoveryCatalog || require('../domain/discovery-catalog.cjs');
  return {
    discoveryAreas: async (req, res) => {
      const { q } = require('../http/public-schemas').discoveryAreaQuery.parse(req.query);
      const found = q.length >= 2 ? catalog.searchDiscoveryAreas(q, 8) : { items: [], hasMore: false };
      res.json({ data: { items: found.items.slice(0, 8).map(areaMetadata), hasMore: Boolean(found.hasMore) } });
    },
    batchEvents: async (req, res) => {
      const ids = require('../http/public-schemas').batchQuery.parse(req.query).ids;
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
      if (req.query.pageSize !== undefined) return res.json({ data: await pagedEvents(models, discoveryQuery.parse(req.query), catalog) });
      const legacyQuery = require('../http/public-schemas').legacyDiscoveryQuery.parse(req.query);
      const area = catalog.resolveNationalDiscoveryArea(legacyQuery.city);
      if (!area && !legacyQuery.allCities) return res.json({ data: [] });
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
      if (legacyQuery.category) where.category = legacyQuery.category;
      const candidates = await models.Event.findAll({ where, replacements: areaReplacements(area), attributes: ['id'], include: [{ model: models.Location, as: 'location', attributes: [], ...(area ? { required: true, where: literal(areaPredicate(legacyQuery, area, 'location')) } : {}) }, { model: models.Organization, as: 'organization', attributes: ['id', 'planTier'] }, { model: models.User, as: 'creator', attributes: [] }], order: [['startsAt', 'ASC']], limit: Math.min(legacyQuery.limit || 50, 100), subQuery: false });
      const events = candidates.length ? await models.Event.findAll({ where: { id: candidates.map((event) => event.id) }, include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] }, { model: models.Offering, as: 'offerings', required: false }], order: [['startsAt', 'ASC']] }) : [];
      res.json({ data: events.map(publicEvent) });
    },
    getEvent: async (req, res) => {
      const event = await models.Event.findByPk(req.params.eventId, { include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug', 'planTier'] }, { model: models.Offering, as: 'offerings', required: false }] });
      if (!event || event.status !== 'published') throw require('../domain/errors').notFound('Event');
      try { await assertActiveEvent(models, event); } catch (error) { if (![403, 404].includes(error.status)) throw error; throw require('../domain/errors').notFound('Event'); }
      res.json({ data: publicEvent(event) });
    },
  };
}
module.exports = { createPublicController, publicEvent, redactLocation };
