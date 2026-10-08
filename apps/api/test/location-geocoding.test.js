const test = require('node:test');
const assert = require('node:assert/strict');
const { createCensusGeocoder, createLocationGeocodingService, parseCensusMatch } = require('../src/services/location-geocoding-service');
const { locationAddressHash, invalidateLocationGeography } = require('../src/domain/location-geography');
const { redactLocation } = require('../src/controllers/public-controller');
const { createPublicController } = require('../src/controllers/public-controller');
const { getConfig } = require('../src/config');

const address = { id: 'test', privacy: 'public', addressLine1: '100 Fixture Street', addressLine2: 'Unit 5', city: 'Orlando', region: 'Florida', postalCode: '32801', countryCode: 'US' };
const matched = () => ({ result: { input: { benchmark: { benchmarkName: 'Public_AR_Current' }, vintage: { vintageName: 'Current_Current' } },
  addressMatches: [{ matchedAddress: '100 FIXTURE STREET, ORLANDO, FL, 32801', addressComponents: { state: 'FL', zip: '32801' },
    coordinates: { x: -81.3781234, y: 28.5381234 }, geographies: { Counties: [{ GEOID: '12095', STATE: '12', COUNTY: '095' }] } }] } });

test('Census address disclosure stays off locally and in tests, and is public-US-only; no private unit is sent', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, text: async () => JSON.stringify(matched()) }; };
  for (const NODE_ENV of ['development', 'test']) for (const override of [undefined, '', 'census', 'disabled']) {
    assert.equal(getConfig({ NODE_ENV, LOCATION_GEOCODING_PROVIDER: override }).LOCATION_GEOCODING_PROVIDER, 'disabled');
  }
  assert.throws(() => getConfig({ NODE_ENV: 'test', LOCATION_GEOCODING_PROVIDER: 'unknown' }));
  await createCensusGeocoder({ fetchImpl }).geocode(address);
  const service = createCensusGeocoder({ enabled: true, fetchImpl });
  for (const input of [{ ...address, privacy: 'private' }, { ...address, privacy: 'attendees_only' }, { ...address, countryCode: 'CA' }, { ...address, addressLine1: '' }]) {
    assert.equal((await service.geocode(input)).status, 'unsupported');
  }
  assert.equal(calls.length, 0);
  assert.equal((await service.geocode(address)).status, 'matched');
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://geocoding.geo.census.gov'); assert.equal(url.searchParams.get('state'), 'FL');
  assert.equal(url.searchParams.get('street'), address.addressLine1); assert.doesNotMatch(calls[0].url, /Unit|key|token/);
  assert.equal(calls[0].options.redirect, 'error');
  await service.geocode({ ...address }); assert.equal(calls.length, 1, 'successful public address fingerprint is cached');
  await service.geocode({ ...address, addressLine2: 'Unit 6' }); assert.equal(calls.length, 2, 'address changes invalidate the cache identity');
});

test('only unique complete matching-state Census county results are trusted; errors are not no matches', async () => {
  assert.deepEqual(parseCensusMatch(matched(), address), { status: 'matched', latitude: 28.538123, longitude: -81.378123, countyFips: '12095', benchmark: 'Public_AR_Current', vintage: 'Current_Current' });
  assert.equal(parseCensusMatch({ result: { addressMatches: [] } }, address).status, 'unmatched');
  const multiple = matched(); multiple.result.addressMatches.push(multiple.result.addressMatches[0]);
  assert.equal(parseCensusMatch(multiple, address).status, 'ambiguous');
  for (const mutate of [match => { match.coordinates.x = null; }, match => { match.coordinates.y = 91; },
    match => { match.addressComponents.state = 'GA'; }, match => { match.addressComponents.zip = '33101'; }, match => { match.geographies.Counties = []; }]) {
    const invalid = matched(); mutate(invalid.result.addressMatches[0]); assert.equal(parseCensusMatch(invalid, address).status, 'unmatched');
  }
  assert.throws(() => parseCensusMatch({ error: 'provider error' }, address), /Invalid Census/);
  await assert.rejects(() => createCensusGeocoder({ enabled: true, fetchImpl: async () => ({ ok: false }) }).geocode(address), /unavailable/);
  await assert.rejects(() => createCensusGeocoder({ enabled: true, fetchImpl: async () => { throw new Error(`provider echoed ${address.addressLine1}`); } }).geocode(address), error => error.message === 'Census geocoder unavailable');
});

test('address or privacy edits invalidate trust and points; name-only edits retain them', () => {
  const original = { ...address, countyFips: '12095', geocodeStatus: 'matched', geocodeSource: 'census', latitude: 28, longitude: -81, geo: {}, geocodeAddressHash: 'old', geocodeAttempts: 2 };
  for (const changed of ['city', 'addressLine1', 'addressLine2', 'region', 'postalCode', 'countryCode', 'privacy']) {
    const value = { ...original, isNewRecord: false, changed: key => key === changed, set(key, next) { this[key] = next; } };
    invalidateLocationGeography(value);
    assert.equal(value.geocodeStatus, 'pending'); assert.equal(value.latitude, null); assert.equal(value.longitude, null); assert.equal(value.geo, null);
    assert.equal(value.countyFips, null); assert.equal(value.geocodeAddressHash, null); assert.equal(value.geocodeAttempts, 0);
  }
  const value = { ...original, isNewRecord: false, changed: key => key === 'name', set(key, next) { this[key] = next; } };
  invalidateLocationGeography(value); assert.equal(value.geocodeStatus, 'matched'); assert.equal(value.countyFips, '12095');
  assert.equal(locationAddressHash(address), locationAddressHash({ ...address, city: '  ORLANDO  ', addressLine1: '\t100  Fixture\nStreet ' }));
  assert.notEqual(locationAddressHash(address), locationAddressHash({ ...address, addressLine2: 'Unit 6' }));
});

test('worker claims bounded pending rows, excludes legacy backfill, and commits only current fingerprints', async () => {
  const queries = [], location = { ...address, addressHash: locationAddressHash(address), claimAttempt: 2 };
  const sequelize = { query: async (sql, options) => { queries.push({ sql, options }); return sql.includes('RETURNING loc.id') || sql.startsWith('SELECT id,address_line1') ? [location] : []; } };
  const disabled = createLocationGeocodingService({ sequelize }); await disabled.drain(); assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /geocode_attempts >= 3/); queries.length = 0;
  const service = createLocationGeocodingService({ sequelize, geocoder: { enabled: true, geocode: async () => { throw new Error('private provider body'); } }, batchSize: 100 });
  assert.equal(await service.drain(), 1);
  assert.equal(queries[1].options.replacements.batchSize, 20);
  assert.match(queries[1].sql, /FOR UPDATE SKIP LOCKED/); assert.doesNotMatch(queries[1].sql, /'unverified'/);
  assert.match(queries[2].sql, /privacy='public'/); assert.match(queries[2].sql, /geocode_attempts=:claimAttempt/);
  assert.match(queries[2].sql, /geocode_address_hash=location_address_hash/);
  assert.equal(queries[3].options.replacements.status, 'error'); assert.equal(queries[3].options.replacements.hash, location.addressHash);
  assert.equal(queries[3].options.replacements.claimAttempt, 2); assert.match(queries[3].sql, /geocode_attempts=:claimAttempt/);
  assert.match(queries[3].sql, /geocode_address_hash=location_address_hash/); assert.doesNotMatch(JSON.stringify(queries), /private provider body/);
  await service.stop(); assert.equal(await service.drain(), 0);
});

test('worker rechecks privacy, address and claim immediately before dispatching each batch item', async () => {
  for (const change of ['privacy', 'address', 'claim']) {
    const first = { ...address, id: 'first', addressHash: locationAddressHash(address), claimAttempt: 1 };
    const second = { ...address, id: 'second', addressLine1: '200 Fixture Street', claimAttempt: 1 };
    second.addressHash = locationAddressHash(second);
    const current = new Map([first, second].map(location => [location.id, { ...location }]));
    const calls = [], checks = [];
    const service = createLocationGeocodingService({ sequelize: { query: async (sql, options) => {
      if (sql.includes('RETURNING loc.id')) return [first, second];
      if (!sql.startsWith('SELECT id,address_line1')) return [];
      checks.push(options.replacements.id);
      const row = current.get(options.replacements.id);
      return row.privacy === 'public' && locationAddressHash(row) === options.replacements.hash && row.claimAttempt === options.replacements.claimAttempt ? [{ ...row }] : [];
    } }, geocoder: { enabled: true, geocode: async location => {
      calls.push(location.id); const changed = current.get('second');
      if (change === 'privacy') changed.privacy = 'private';
      else if (change === 'address') changed.addressLine1 = 'Changed Fixture Street';
      else changed.claimAttempt++;
      return { status: 'unmatched' };
    } } });
    assert.equal(await service.drain(), 2); assert.deepEqual(checks, ['first', 'second']);
    assert.deepEqual(calls, ['first'], `${change} after batch claim prevents later address disclosure`);
  }
});

test('public and authorized attendee serialization never discloses internal geography provenance', () => {
  const value = { ...address, privacy: 'attendees_only', countyFips: '12095', geocodeAddressHash: 'internal', geocodeStatus: 'matched', latitude: 28, longitude: -81 };
  const location = { toJSON: () => ({ ...value }) };
  assert.equal(redactLocation(location).addressLine1, undefined);
  const allowed = redactLocation(location, { includeAttendeeAddress: true }); assert.equal(allowed.addressLine1, address.addressLine1);
  assert.equal(allowed.countyFips, undefined); assert.equal(allowed.geocodeAddressHash, undefined); assert.equal(allowed.geocodeStatus, undefined);
});

test('historical public address queue is explicit, bounded and dry-run by default without disclosure', async () => {
  const queries = [];
  const service = createLocationGeocodingService({ sequelize: { query: async (sql, options) => { queries.push({ sql, options }); return sql.includes('COUNT(*)') ? [{ eligible: 11 }] : [{ id: 'fixture' }]; } } });
  assert.deepEqual(await service.enqueueHistorical({ limit: 10 }), { eligible: 10, queued: 0, hasMore: true, dryRun: true });
  assert.equal(queries[0].options.replacements.limit, 11); assert.match(queries[0].sql, /privacy='public'/); assert.match(queries[0].sql, /geocode_status='unverified'/);
  assert.match(queries[0].sql, /e.status IN \('published','draft'\)/); assert.doesNotMatch(queries[0].sql, /SET geocode/);
  assert.deepEqual(await service.enqueueHistorical({ limit: 10, dryRun: false }), { queued: 1, dryRun: false });
  assert.match(queries[1].sql, /FOR UPDATE SKIP LOCKED/); assert.match(queries[1].sql, /SET geocode_status='pending'/);
  await assert.rejects(() => service.enqueueHistorical({ limit: 501 }), /limit from 1 to 500/);
});

test('radius filtering uses trusted indexed geography before limit, not city text or legacy demo points', async () => {
  const radius = { key: 'us:place:12345', label: 'Fixtureville, FL', city: 'Fixtureville', region: 'FL', countryCode: 'US', kind: 'radius', version: 'fixture1',
    center: { latitude: 28, longitude: -81 }, radiusMeters: 48280.32, resolutionStatus: 'resolved' };
  const queries = [];
  const models = { Event: { sequelize: { query: async (sql, options) => { queries.push({ sql, options });
    return queries.length === 1 ? [] : queries.length === 2 ? [{ hasUpcomingAreaEvents: false }] : [{ incomplete: true }]; } } } };
  const controller = createPublicController({ models, discoveryCatalog: { resolveNationalDiscoveryArea: () => radius } });
  let response;
  await controller.listEvents({ query: { city: radius.label, pageSize: '8', startDate: '2031-11-02', endDate: '2031-11-09' } }, { json: value => { response = value.data; } });
  assert.match(queries[0].sql, /ST_DWithin\(loc\.geo/); assert.match(queries[0].sql, /geocode_status='matched'/);
  assert.match(queries[0].sql, /geocode_address_hash=location_address_hash/); assert.doesNotMatch(queries[0].sql, /areaMembers/);
  assert.equal(queries[0].options.replacements.areaRadius, 48280.32); assert.equal(queries[0].options.replacements.pageSize, 9);
  assert.equal(response.area.radiusMiles, 30); assert.equal(response.area.geographyCoverage, 'verified-addresses-only');
  assert.equal(response.hasUpcomingAreaEvents, null, 'pending addresses must not imply confirmed coming-soon');
});

test('metro scope uses authoritative current counties and cross-state locality tuples without radius widening', async () => {
  const area = { key: 'us:metro:fixture', label: 'Example, FL', city: 'Example', region: 'FL', countryCode: 'US', kind: 'metro', version: 'fixture1',
    counties: ['12095', '13001'], resolutionStatus: 'resolved', members: [{ city: 'Example', region: 'FL', countryCode: 'US' }, { city: 'Border Town', region: 'GA', countryCode: 'US' }] };
  const queries = [];
  const controller = createPublicController({ models: { Event: { sequelize: { query: async (sql, options) => { queries.push({ sql, options }); return queries.length === 1 ? [] : [{ hasUpcomingAreaEvents: false }]; } } } },
    discoveryCatalog: { resolveNationalDiscoveryArea: () => area } });
  let response;
  await controller.listEvents({ query: { city: area.label, pageSize: '8', startDate: '2031-11-02', endDate: '2031-11-09' } }, { json: value => { response = value.data; } });
  assert.match(queries[0].sql, /county_fips IN \(:areaCounties\)/); assert.match(queries[0].sql, /NOT COALESCE/);
  assert.match(queries[0].sql, /jsonb_to_recordset/); assert.doesNotMatch(queries[0].sql, /ST_DWithin\(loc\.geo/);
  const members = JSON.parse(queries[0].options.replacements.areaMembers);
  assert.ok(members.some(value => value.city === 'border town' && value.region === 'georgia'));
  assert.ok(members.some(value => value.city === 'example' && value.region === 'fl'));
  assert.equal(response.hasUpcomingAreaEvents, false); assert.equal(queries.length, 2);
});
