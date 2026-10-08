const { QueryTypes } = require('sequelize');
const { locationAddressHash, eligiblePublicAddress } = require('../domain/location-geography');
const { discoveryRegionAliases, normalizeDiscoveryText, parseDiscoverySelection } = require('../../../shared/discovery-areas.mjs');

const BENCHMARK = 'Public_AR_Current';
const VINTAGE = 'Current_Current';
const MAX_RESPONSE_BYTES = 524288;
const stateAliases = location => discoveryRegionAliases({ region: parseDiscoverySelection(`Venue, ${location.region}, US`)?.region || location.region, countryCode: 'US' });
function parseCensusMatch(payload, location) {
  const matches = payload?.result?.addressMatches;
  if (!Array.isArray(matches)) throw new Error('Invalid Census geocoder response');
  if (!matches.length) return { status: 'unmatched' };
  if (matches.length !== 1) return { status: 'ambiguous' };
  const match = matches[0], counties = match.geographies?.Counties;
  const latitude = Number(match.coordinates?.y), longitude = Number(match.coordinates?.x);
  const countyFips = counties?.[0]?.GEOID || (counties?.[0]?.STATE && counties?.[0]?.COUNTY ? `${counties[0].STATE}${counties[0].COUNTY}` : null);
  const requestedZip = String(location.postalCode || '').trim().match(/^\d{5}/)?.[0];
  if (!match.matchedAddress || !Array.isArray(counties) || counties.length !== 1 || !/^\d{5}$/.test(countyFips || '')
    || match.coordinates?.x == null || match.coordinates?.y == null || match.coordinates.x === '' || match.coordinates.y === ''
    || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || !stateAliases(location).includes(normalizeDiscoveryText(match.addressComponents?.state))
    || requestedZip && String(match.addressComponents?.zip || '').slice(0, 5) !== requestedZip) {
    return { status: 'unmatched' };
  }
  return { status: 'matched', latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)), countyFips,
    benchmark: String(payload.result.input?.benchmark?.benchmarkName || BENCHMARK).slice(0, 80),
    vintage: String(payload.result.input?.vintage?.vintageName || VINTAGE).slice(0, 80) };
}
function createCensusGeocoder({ enabled = false, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const cache = new Map();
  return {
    enabled,
    async geocode(location) {
      if (!enabled || !eligiblePublicAddress(location)) return { status: 'unsupported' };
      const hash = locationAddressHash(location), cached = cache.get(hash);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.result };
      const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/address');
      const state = stateAliases(location).find(value => /^[a-z]{2}$/.test(value))?.toUpperCase();
      if (!state) return { status: 'unsupported' };
      for (const [key, value] of Object.entries({ street: location.addressLine1, city: location.city, state,
        zip: location.postalCode || '', benchmark: BENCHMARK, vintage: VINTAGE, format: 'json' })) url.searchParams.set(key, value);
      let response;
      try { response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { Accept: 'application/json' } }); }
      catch { throw new Error('Census geocoder unavailable'); }
      if (!response.ok || Number(response.headers?.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new Error('Census geocoder unavailable');
      let body = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(); let bytes = 0;
        const decoder = new TextDecoder();
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw new Error('Census geocoder response too large'); body += decoder.decode(value, { stream: true }); }
          body += decoder.decode();
        } finally { await reader.cancel(); }
      } else { body = await response.text(); if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('Census geocoder response too large'); }
      let payload;
      try { payload = JSON.parse(body); } catch { throw new Error('Invalid Census geocoder response'); }
      const result = parseCensusMatch(payload, location);
      if (result.status === 'matched') {
        if (cache.size >= 1000) cache.delete(cache.keys().next().value);
        cache.set(hash, { result: { ...result }, expiresAt: Date.now() + 86400000 });
      }
      return result;
    },
  };
}
function createLocationGeocodingService({ sequelize, config = {}, geocoder = createCensusGeocoder({ enabled: config.LOCATION_GEOCODING_PROVIDER === 'census' }), batchSize = 5 }) {
  const enabled = geocoder.enabled === true; let stopping = false;
  return {
    enabled,
    async enqueueHistorical({ limit = 100, dryRun = true } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500 || typeof dryRun !== 'boolean') throw new Error('Historical geography queue requires a limit from 1 to 500 and explicit dry-run choice');
      const eligible = `loc.lifecycle_state='active' AND loc.privacy='public' AND upper(btrim(loc.country_code))='US'
        AND loc.geocode_status='unverified' AND nullif(btrim(loc.address_line1),'') IS NOT NULL
        AND nullif(btrim(loc.city),'') IS NOT NULL AND nullif(btrim(loc.region),'') IS NOT NULL
        AND EXISTS (SELECT 1 FROM events e LEFT JOIN organizations org ON org.id=e.organization_id
          WHERE e.location_id=loc.id AND e.lifecycle_state='active' AND e.status IN ('published','draft') AND e.ends_at>=NOW()
          AND (e.organization_id IS NULL OR (org.lifecycle_state='active' AND org.status='active')))`;
      if (dryRun) {
        const [row] = await sequelize.query(`SELECT COUNT(*)::int AS eligible FROM (SELECT loc.id FROM locations loc
          WHERE ${eligible} ORDER BY loc.id LIMIT :limit) candidates`, { replacements: { limit: limit + 1 }, type: QueryTypes.SELECT });
        return { eligible: Math.min(row.eligible, limit), queued: 0, hasMore: row.eligible > limit, dryRun: true };
      }
      const rows = await sequelize.query(`WITH candidates AS (SELECT loc.id FROM locations loc WHERE ${eligible}
        ORDER BY loc.id LIMIT :limit FOR UPDATE SKIP LOCKED)
        UPDATE locations loc SET geocode_status='pending',geocode_attempts=0,geocode_next_attempt_at=NULL
        FROM candidates WHERE loc.id=candidates.id RETURNING loc.id`, { replacements: { limit }, type: QueryTypes.SELECT });
      return { queued: rows.length, dryRun: false };
    },
    async drain() {
      if (stopping) return 0;
      // A crashed last attempt must not leave a location processing forever.
      // This bounded lease cleanup is safe even with address disclosure off.
      await sequelize.query(`WITH expired AS (SELECT id FROM locations WHERE geocode_status='processing'
        AND geocode_attempts >= 3 AND geocode_next_attempt_at <= NOW()
        ORDER BY geocode_next_attempt_at,id LIMIT 20 FOR UPDATE SKIP LOCKED)
        UPDATE locations loc SET geocode_status='error',geocode_next_attempt_at=NULL
        FROM expired WHERE loc.id=expired.id`);
      if (!enabled) return 0;
      // Only newly authored/changed addresses are pending. Old unverified rows
      // are not automatically backfilled when a provider is enabled.
      const rows = await sequelize.query(`WITH candidates AS (
        SELECT id FROM locations WHERE privacy='public' AND upper(btrim(country_code))='US'
          AND geocode_status IN ('pending','processing','error') AND geocode_attempts < 3
          AND (geocode_next_attempt_at IS NULL OR geocode_next_attempt_at <= NOW())
          ORDER BY geocode_next_attempt_at NULLS FIRST,updated_at,id LIMIT :batchSize FOR UPDATE SKIP LOCKED)
        UPDATE locations loc SET geocode_status='processing',geocode_attempts=loc.geocode_attempts+1,
          geocode_next_attempt_at=NOW()+INTERVAL '5 minutes',
          geocode_address_hash=location_address_hash(loc.address_line1,loc.address_line2,loc.city,loc.region,loc.postal_code,loc.country_code)
        FROM candidates WHERE loc.id=candidates.id
        RETURNING loc.id,loc.address_line1 AS "addressLine1",loc.address_line2 AS "addressLine2",loc.city,loc.region,
          loc.postal_code AS "postalCode",loc.country_code AS "countryCode",loc.privacy,
          loc.geocode_address_hash AS "addressHash",loc.geocode_attempts AS "claimAttempt"`, { replacements: { batchSize: Math.max(1, Math.min(batchSize, 20)) }, type: QueryTypes.SELECT });
      for (const location of rows) {
        if (stopping) break;
        // A later item in this batch may have become private or changed address
        // while an earlier provider request was in flight. Check current public
        // authorization and the claim again immediately before disclosure.
        const [current] = await sequelize.query(`SELECT id,address_line1 AS "addressLine1",address_line2 AS "addressLine2",city,region,
          postal_code AS "postalCode",country_code AS "countryCode",privacy,geocode_address_hash AS "addressHash"
          FROM locations WHERE id=:id AND privacy='public' AND upper(btrim(country_code))='US'
            AND geocode_status='processing' AND geocode_attempts=:claimAttempt AND geocode_address_hash=:hash
            AND geocode_address_hash=location_address_hash(address_line1,address_line2,city,region,postal_code,country_code) LIMIT 1`,
        { replacements: { id: location.id, claimAttempt: location.claimAttempt, hash: location.addressHash }, type: QueryTypes.SELECT });
        if (!current || stopping) continue;
        let result;
        try { result = await geocoder.geocode(current); } catch { result = { status: 'error' }; }
        // The fingerprint predicate makes a provider result arriving after an
        // address edit harmless. Provider errors are recorded, not zero matches.
        await sequelize.query(`UPDATE locations SET geocode_status=:status,geocode_source=:source,
          county_fips=:county,latitude=:latitude,longitude=:longitude,
          geo=CASE WHEN :status = 'matched' THEN ST_SetSRID(ST_MakePoint(CAST(:longitude AS double precision),CAST(:latitude AS double precision)),4326)::geography ELSE NULL END,
          geocode_benchmark=:benchmark,geocode_vintage=:vintage,geocoded_at=CASE WHEN :status = 'matched' THEN NOW() ELSE NULL END,
          geocode_next_attempt_at=CASE WHEN :status = 'error' AND geocode_attempts < 3 THEN NOW()+INTERVAL '5 minutes' ELSE NULL END
          WHERE id=:id AND privacy='public' AND geocode_status='processing' AND geocode_attempts=:claimAttempt AND geocode_address_hash=:hash
            AND geocode_address_hash=location_address_hash(address_line1,address_line2,city,region,postal_code,country_code)`,
        { replacements: { id: location.id, claimAttempt: location.claimAttempt, hash: location.addressHash || locationAddressHash(location), status: result.status,
          source: result.status === 'matched' ? 'census' : null, county: result.countyFips || null,
          latitude: result.latitude ?? null, longitude: result.longitude ?? null, benchmark: result.benchmark || null, vintage: result.vintage || null } });
      }
      return rows.length;
    },
    async stop() { stopping = true; },
  };
}
module.exports = { createCensusGeocoder, createLocationGeocodingService, parseCensusMatch };
