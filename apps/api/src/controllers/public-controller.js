const { offeringSaleState, eventFinished } = require('../domain/event-policy');
const { Op, QueryTypes, literal } = require('sequelize');
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { assertActiveEvent } = require('../services/lifecycle-service');
const { discoveryQuery } = require('../http/public-schemas');
const { effectiveFeeMode } = require('@nitewide/pricing');
const { discoveryRegionAliases, normalizeDiscoveryText } = require('../../../shared/discovery-areas.mjs');
const { trustedLocationSql } = require('../domain/location-geography');
const rankingVersion = 'recommended-v2';
const cursorSchema = z.object({ version: z.literal(3), startsAt: z.iso.datetime({ offset: true }),
  day: z.iso.date(), premium: z.boolean(), popularity: z.number().finite().min(0).max(30).nullable(),
  distanceMeters: z.number().finite().nonnegative().nullable(),
  rankedAsOf: z.iso.datetime({ offset: true }), id: z.uuid(), filter: z.string().length(64) }).strict();
const discoveryFilterKey = (input, area, rankedAsOf) => createHash('sha256').update(JSON.stringify([
  input.allCities ? 'all-cities' : [area?.key || `unresolved:${normalizeDiscoveryText(input.city)}`, area?.kind, area?.version,
    area?.placeKey || area?.label, area?.center || null, area?.kind === 'radius' ? area.radiusMeters : null],
  input.mode, input.scope, input.sort, input.startDate, input.endDate || null, input.query, input.category, input.timezone,
  rankingVersion, rankedAsOf])).digest('hex');
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
  if (area.kind === 'city' && area.counties?.length) return `${memberPredicate}
    AND (NOT COALESCE((${trustedLocationSql(alias)}),false) OR ${alias}.county_fips IN (:areaCounties))`;
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
    ...(['metro', 'division'].includes(area.kind) || area.kind === 'city' && area.counties?.length ? { areaCounties: area.counties?.length ? area.counties : ['00000'] } : {}) };
}
function areaMetadata(area) {
  if (!area) return null;
  return { key: area.key, label: area.label, city: area.city, region: area.region, countryCode: area.countryCode, kind: area.kind || 'city',
    ...(area.groupLabel ? { groupLabel: area.groupLabel } : {}), ...(area.kind === 'radius' ? { radiusMiles: 30, centerLabel: area.label, geographyCoverage: 'verified-addresses-only' } : {}) };
}
function cityScope(area) {
  if (!area) return null;
  const cityAliases = area.cityAliases?.length ? area.cityAliases : [area.city];
  return { ...area, key: area.placeKey ? `${area.countryCode.toLowerCase()}:city:${area.placeKey.slice(6)}` : `city:${area.key}`,
    kind: 'city', groupLabel: undefined, radiusMeters: undefined, radiusMiles: undefined,
    localities: cityAliases, counties: area.cityCounties || [], members: cityAliases.map(city => ({ city, region: area.region, countryCode: area.countryCode })) };
}
function decodeCursor(value) {
  if (!value) return null;
  const { DomainError } = require('../domain/errors');
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    const referenceTime = Date.parse(cursor.rankedAsOf);
    if (referenceTime > Date.now()) throw new Error('Invalid ranking reference');
    if (referenceTime < Date.now() - 86400000) throw new DomainError('Discovery page expired; refresh results to continue', { code: 'DISCOVERY_CURSOR_EXPIRED', status: 422 });
    return cursor;
  } catch (error) {
    if (error.code === 'DISCOVERY_CURSOR_EXPIRED') throw error;
    throw new DomainError('Invalid discovery cursor', { code: 'VALIDATION_ERROR', status: 422 });
  }
}
async function pagedEvents(models, input, catalog) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }); }
  catch { throw new (require('../domain/errors').DomainError)('Invalid discovery timezone', { code: 'VALIDATION_ERROR', status: 422 }); }
  const selectedArea = catalog.resolveNationalDiscoveryArea(input.city);
  const area = input.scope === 'city' ? cityScope(selectedArea) : selectedArea;
  const origin = !input.allCities && selectedArea?.center && Number.isFinite(selectedArea.center.latitude) && Number.isFinite(selectedArea.center.longitude)
    ? selectedArea.center : null;
  const cursor = decodeCursor(input.cursor);
  const rankedAsOf = cursor?.rankedAsOf || new Date().toISOString();
  const filter = discoveryFilterKey(input, area, rankedAsOf);
  if (cursor && (cursor.filter !== filter || (input.sort === 'recommended') !== (cursor.popularity !== null))) throw new (require('../domain/errors').DomainError)('Invalid discovery cursor', { code: 'VALIDATION_ERROR', status: 422 });
  const resolved = Boolean(input.allCities || area?.resolutionStatus === 'resolved');
  const metadata = { area: areaMetadata(area), hasUpcomingAreaEvents: resolved ? false : null, resolutionStatus: resolved ? 'resolved' : 'unresolved',
    mode: input.mode, scope: input.scope, sort: input.sort, rankedAsOf, rankingVersion: input.sort === 'recommended' ? rankingVersion : null,
    distanceOrigin: origin ? { label: selectedArea.label, kind: 'city-center' } : null };
  if (!area && !input.allCities) return { items: [], hasMore: false, nextCursor: null, ...metadata };
  const replacements = {
    pageSize: input.pageSize + 1,
    ...areaReplacements(area),
    startDate: input.startDate,
    endDate: input.endDate || null,
    timezone: input.timezone,
    rankedAsOf,
    originLatitude: origin?.latitude ?? null,
    originLongitude: origin?.longitude ?? null,
    cursorStart: cursor?.startsAt || null,
    cursorDistance: cursor?.distanceMeters ?? null,
    cursorDay: cursor?.day || null,
    cursorPremium: cursor?.premium ?? false,
    cursorPopularity: cursor?.popularity ?? null,
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
  const afterStart = `(e.starts_at > CAST(:cursorStart AS timestamptz) OR (e.starts_at = CAST(:cursorStart AS timestamptz) AND e.id > CAST(:cursorId AS uuid)))`;
  const afterDistance = `((:cursorDistance IS NOT NULL AND (geo.distance_meters IS NULL OR geo.distance_meters > CAST(:cursorDistance AS double precision)))
    OR (geo.distance_meters IS NOT DISTINCT FROM CAST(:cursorDistance AS double precision) AND ${afterStart}))`;
  const premiumSql = "COALESCE(org.plan_tier='premium',false)";
  const keyset = input.sort === 'date' ? afterStart : input.sort === 'distance'
    ? afterDistance
    : `(event_day."day" > :cursorDay OR (event_day."day" = :cursorDay AND (
      ${premiumSql} < CAST(:cursorPremium AS boolean) OR (${premiumSql} = CAST(:cursorPremium AS boolean) AND (
        rank.popularity < CAST(:cursorPopularity AS double precision) OR (rank.popularity = CAST(:cursorPopularity AS double precision) AND ${afterDistance}))))))`;
  const order = input.sort === 'date' ? 'e.starts_at ASC,e.id ASC' : input.sort === 'distance'
    ? 'geo.distance_meters ASC NULLS LAST,e.starts_at ASC,e.id ASC'
    : `event_day."day" ASC,${premiumSql} DESC,rank.popularity DESC,geo.distance_meters ASC NULLS LAST,e.starts_at ASC,e.id ASC`;
  // Indexed, bounded historical engagement only: no orders/bookings aggregate
  // per page. One actor's strongest signal wins, anonymous visits are capped,
  // checkout starts do not count, and known creator/referrer self-signals do not count.
  const engagement = input.sort === 'recommended' ? `CROSS JOIN LATERAL (SELECT
    COALESCE(SUM(actor.weight) FILTER (WHERE actor.weight >= 1),0) + LEAST(1,COALESCE(SUM(actor.weight) FILTER (WHERE actor.weight < 1),0)) AS weighted_actors
    FROM (SELECT COALESCE('user:' || recent.user_id::text,'session:' || NULLIF(recent.session_key,'')) AS actor_id,
      MAX(CASE WHEN recent.action='purchase' AND recent.user_id IS NOT NULL THEN 3
        WHEN recent.action='guestlist' AND recent.user_id IS NOT NULL THEN 1 WHEN recent.action='visit' THEN 0.125 ELSE 0 END) AS weight
      FROM (SELECT aa.user_id,aa.session_key,aa.action,aa.event_affiliate_id FROM affiliate_attributions aa
        WHERE aa.event_id=e.id AND aa.action IN ('visit','guestlist','purchase')
          AND aa.occurred_at >= CAST(:rankedAsOf AS timestamptz)-INTERVAL '30 days' AND aa.occurred_at <= CAST(:rankedAsOf AS timestamptz)
          AND aa.created_at <= CAST(:rankedAsOf AS timestamptz)
        ORDER BY aa.occurred_at DESC,aa.id DESC LIMIT 256) recent
      LEFT JOIN event_affiliates referrer ON referrer.id=recent.event_affiliate_id
      WHERE (recent.user_id IS NOT NULL OR NULLIF(recent.session_key,'') IS NOT NULL)
        AND recent.user_id IS DISTINCT FROM e.creator_user_id
        AND (recent.user_id IS NULL OR recent.user_id IS DISTINCT FROM referrer.user_id)
      GROUP BY actor_id) actor) engagement
    CROSS JOIN LATERAL (SELECT ROUND(LEAST(30,10*LN(1+engagement.weighted_actors))::numeric,6)::double precision AS popularity) rank`
    : 'CROSS JOIN LATERAL (SELECT NULL::double precision AS popularity) rank';
  const ids = await models.Event.sequelize.query(`
    SELECT e.id,to_char(e.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startsAt",
      event_day."day",${premiumSql} AS premium,geo.distance_meters AS "distanceMeters",rank.popularity
    FROM events e
    LEFT JOIN organizations org ON org.id=e.organization_id
    LEFT JOIN locations loc ON loc.id=e.location_id
    LEFT JOIN users creator ON creator.id=e.creator_user_id
    CROSS JOIN LATERAL (SELECT concat_ws(' ', e.title, e.description, e.summary, org.name,
      loc.name, loc.city, loc.region, e.category,
      (SELECT string_agg(concat_ws(' ', offer.name, offer.description), ' ') FROM offerings offer
        WHERE offer.event_id=e.id AND offer.is_active=true AND offer.visibility='public')) AS text) searchable
    CROSS JOIN LATERAL (SELECT to_char(e.starts_at AT TIME ZONE COALESCE(NULLIF(loc.timezone,''),:timezone), 'YYYY-MM-DD') AS "day") event_day
    CROSS JOIN LATERAL (SELECT CASE WHEN :originLatitude IS NOT NULL AND :originLongitude IS NOT NULL AND (${trustedLocationSql('loc')})
      THEN ROUND(ST_Distance(loc.geo,ST_SetSRID(ST_MakePoint(CAST(:originLongitude AS double precision),CAST(:originLatitude AS double precision)),4326)::geography)::numeric,3)::double precision
      ELSE NULL::double precision END AS distance_meters) geo
    ${engagement}
    WHERE ${eligibilityPredicate}
      AND e.starts_at >= (CAST(:startDate AS date) - INTERVAL '14 hours')
      ${input.mode === 'range' ? `AND e.starts_at < (CAST(:endDate AS date) + INTERVAL '36 hours') AND event_day."day" <= :endDate` : ''}
      AND event_day."day" >= :startDate
      AND (${areaPredicate(input, area)})
      ${wordPredicates.length ? `AND ${wordPredicates.join(' AND ')}` : ''}
      ${categoryPredicate}
      AND (:cursorStart IS NULL OR ${keyset})
    ORDER BY ${order} LIMIT :pageSize
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
    items: page.filter(row => byId.has(row.id)).map(row => ({ ...publicEvent(byId.get(row.id)),
      distanceMiles: row.distanceMeters == null ? null : Math.round(row.distanceMeters / 1609.344 * 10) / 10 })),
    hasMore: ids.length > input.pageSize,
    nextCursor: ids.length > input.pageSize && last ? Buffer.from(JSON.stringify({ version: 3, startsAt: last.startsAt,
      day: last.day, premium: last.premium, popularity: last.popularity, distanceMeters: last.distanceMeters,
      rankedAsOf, id: last.id, filter })).toString('base64url') : null,
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
      const found = q.length >= 2 ? catalog.searchDiscoveryAreas(q, 5) : { items: [], hasMore: false };
      res.json({ data: { items: found.items.slice(0, 5).map(areaMetadata), hasMore: Boolean(found.hasMore) } });
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
