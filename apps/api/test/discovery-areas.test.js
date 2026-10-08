const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDiscoverySelection, discoveryRegionAliases, normalizeDiscoveryText } = require('../../shared/discovery-areas.mjs');
const { createPublicController } = require('../src/controllers/public-controller');
const { discoveryQuery, legacyDiscoveryQuery } = require('../src/http/public-schemas');

test('lightweight qualified selection parsing normalizes identities but never invents metro membership', () => {
  for (const value of ['', 'Orlando', 'Atlanta', 'Orlando,', ', FL', 'Miami, Unknown', 'Toronto, ON', 'All cities, FL']) assert.equal(parseDiscoverySelection(value), null, value);
  assert.equal(parseDiscoverySelection('Atlanta, Georgia').key, parseDiscoverySelection('atlanta, GA, US').key);
  assert.equal(parseDiscoverySelection('Toronto, Ontario, Canada').key, parseDiscoverySelection('Toronto, ON, CA').key);
  assert.equal(parseDiscoverySelection('Orlando, WV').label, 'Orlando, WV');
  assert.equal(parseDiscoverySelection('Winter Park, Florida').label, 'Winter Park, FL', 'requested place remains distinct from a server-resolved group');
  assert.deepEqual(discoveryRegionAliases(parseDiscoverySelection('Orlando, FL')), ['fl', 'florida', 'us fl']);
  assert.equal(normalizeDiscoveryText(' St. Petersburg '), 'st petersburg');
  assert.notEqual(parseDiscoverySelection('Orlando, FL').key, parseDiscoverySelection('Orlando, WV').key);
  assert.notEqual(parseDiscoverySelection('Orlando, FL').key, parseDiscoverySelection('Orlando, FL, CA').key);
});

test('unselected discovery fails closed without consulting the event catalog', async () => {
  const controller = createPublicController({ models: { Event: { findAll: () => assert.fail('unresolved discovery queried global catalog'), sequelize: { query: () => assert.fail('unresolved discovery queried global catalog') } } } });
  let result;
  const res = { json: (payload) => { result = payload.data; } };
  for (const city of [undefined, '', 'Orlando', 'Toronto, ON']) {
    await controller.listEvents({ query: { pageSize: '9', startDate: '2031-11-02', endDate: '2031-11-09', ...(city === undefined ? {} : { city }) } }, res);
    assert.deepEqual(result, { items: [], hasMore: false, nextCursor: null, area: null, hasUpcomingAreaEvents: null, resolutionStatus: 'unresolved' });
    await controller.listEvents({ query: city === undefined ? {} : { city } }, res);
    assert.deepEqual(result, []);
  }
});

test('public suggestions expose at most five distinct qualified area choices without querying events', async () => {
  const controller = createPublicController({ models: {} });
  let result;
  const res = { json: (payload) => { result = payload.data; } };
  await controller.discoveryAreas({ query: { q: 'Springfield' } }, res);
  assert.equal(result.items.length, 5);
  assert.equal(new Set(result.items.map((item) => item.key)).size, 5);
  assert.equal(result.hasMore, true);
  await controller.discoveryAreas({ query: { q: 'Miami, FL' } }, res);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].label, 'Miami, FL');
  assert.equal(result.hasMore, false);
});

test('all-city discovery requires a deliberate flag and cannot coexist with a supplied city', () => {
  const base = { pageSize: '9', startDate: '2031-11-02', endDate: '2031-11-09' };
  assert.equal(discoveryQuery.parse(base).allCities, false);
  assert.equal(discoveryQuery.parse({ ...base, allCities: 'true' }).allCities, true);
  assert.equal(legacyDiscoveryQuery.parse({ allCities: 'true' }).allCities, true);
  for (const schema of [discoveryQuery, legacyDiscoveryQuery]) {
    assert.equal(schema.safeParse({ ...base, allCities: 'true', city: 'Orlando, FL' }).success, false);
    assert.equal(schema.safeParse({ ...base, allCities: 'banana' }).success, false);
  }
});
