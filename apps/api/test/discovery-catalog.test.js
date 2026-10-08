const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/data/discovery-catalog.json');
const { resolveNationalDiscoveryArea: resolve, searchDiscoveryAreas: search, countyArea, catalogVersion } = require('../src/domain/discovery-catalog.cjs');

test('pinned Census catalog covers nationwide places, disjoint county scopes and representative city points', () => {
  assert.equal(catalogVersion, 'census-2025-omb-2023-v1');
  assert.equal(catalog.places.length, 32350);
  assert.ok(catalog.groups.length >= 393); // All official metros, before any division splits.
  const states = new Set(catalog.places.map((place) => place[2]));
  assert.equal(states.size, 52); // Fifty states, DC and Puerto Rico.
  const counties = new Set();
  const groups = new Set(catalog.groups.map((group) => group.key));
  for (const group of catalog.groups) {
    assert.match(group.key, /^(?:(?:metro|division):\d{5}|market:[a-z0-9-]+)$/);
    for (const county of group.counties) {
      assert.ok(!counties.has(county), `overlapping county ${county}`);
      counties.add(county);
      assert.equal(countyArea(county).key, `us:${group.key}`);
    }
  }
  for (const [geoid, , , latitude, longitude, parts, centerCounty, groupKey] of catalog.places) {
    assert.match(geoid, /^\d{7}$/);
    assert.ok(Number.isFinite(latitude) && Math.abs(latitude) <= 90);
    assert.ok(Number.isFinite(longitude) && Math.abs(longitude) <= 180);
    assert.ok(parts.includes(centerCounty), `center outside place county crosswalk ${geoid}`);
    if (groupKey) assert.ok(groups.has(groupKey));
  }
  for (const source of catalog.sources) assert.match(source.sha256 || source.transformedRowsSha256, /^[a-f0-9]{64}$/);
});

test('nationwide metros preserve divisions, cross-state counties, current Connecticut and unsafe city portions', () => {
  assert.equal(resolve('Winter Park, Florida').key, resolve('Orlando, FL').key);
  assert.equal(resolve('Miami Beach, FL').key, resolve('Miami, FL').key);
  assert.notEqual(resolve('Miami, FL').key, resolve('Fort Lauderdale, FL').key);
  assert.equal(new Set(['Miami, FL', 'Fort Lauderdale, FL', 'West Palm Beach, FL'].map((city) => resolve(city).key)).size, 3);
  assert.equal(resolve('Boca Raton, FL').key, 'us:division:48424');
  assert.equal(resolve('Tampa, FL').key, resolve('St. Petersburg, FL').key);
  assert.equal(resolve('Clearwater, FL').key, 'us:metro:45300');
  assert.deepEqual(resolve('Tampa, FL').counties, ['12053', '12057', '12101', '12103']);
  assert.deepEqual(catalog.policy.wholeMetroExceptions, ['12060', '16980', '19100', '19820', '37980', '41860', '42660', '45300']);
  for (const [code, cities, removedDivisions] of [
    ['12060', ['Atlanta, GA', 'Marietta, GA', 'Sandy Springs, GA'], ['12054', '31924']],
    ['19100', ['Dallas, TX', 'Fort Worth, TX', 'Arlington, TX', 'Plano, TX'], ['19124', '23104']],
    ['19820', ['Detroit, MI', 'Warren, MI', 'Troy, MI', 'Dearborn, MI'], ['19804', '47664']],
    ['16980', ['Chicago, IL', 'Elgin, IL', 'Naperville, IL', 'Gary, IN'], ['16984', '20994', '29404', '29414']],
    ['37980', ['Philadelphia, PA', 'Camden, NJ', 'Wilmington, DE'], ['15804', '33874', '37964', '48864']],
    ['42660', ['Seattle, WA', 'Bellevue, WA', 'Everett, WA', 'Tacoma, WA'], ['21794', '42644', '45104']],
    ['41860', ['San Francisco, CA', 'Oakland, CA', 'Fremont, CA', 'Berkeley, CA', 'San Rafael, CA'], ['36084', '41884', '42034']],
  ]) {
    const area = resolve(cities[0]);
    assert.equal(area.key, `us:metro:${code}`);
    assert.equal(area.kind, 'metro');
    for (const city of cities) {
      const selected = resolve(city);
      assert.equal(selected.key, area.key, city);
      assert.deepEqual(selected.counties, area.counties, city);
      assert.equal(selected.radiusMeters, undefined, 'metro selection never adds a radius union');
    }
    for (const division of removedDivisions) assert.ok(!catalog.groups.some((group) => group.key === `division:${division}`));
  }
  assert.equal(resolve('Boston, MA').key, 'us:market:boston-ma');
  for (const city of ['Cambridge, MA', 'Newton, MA', 'Framingham, MA']) assert.equal(resolve(city).key, resolve('Boston, MA').key);
  assert.deepEqual(resolve('Boston, MA').counties, ['25009', '25017', '25021', '25023', '25025']);
  assert.notEqual(resolve('Boston, MA').key, resolve('Portsmouth, NH').key, 'New Hampshire division remains separate');
  assert.equal(resolve('Portsmouth, NH').key, 'us:division:40484');
  assert.deepEqual(catalog.policy.divisionCombinations[0].divisionCodes, ['14454', '15764']);
  assert.notEqual(resolve('San Francisco, CA').key, resolve('San Jose, CA').key, 'separate San Jose metro is not included');
  assert.equal(resolve('Hartford, CT').centerCountyFips, '09110');
  const dc = resolve('Washington, DC');
  assert.equal(dc.key, 'us:market:dc-core');
  assert.deepEqual(dc.counties, ['11001', '24031', '24033', '51013', '51059', '51510', '51600', '51610']);
  for (const city of ['Arlington, VA', 'Alexandria, VA', 'Fairfax, VA', 'Falls Church, VA', 'Reston, VA', 'Bethesda, MD', 'Silver Spring, MD']) assert.equal(resolve(city).key, dc.key);
  for (const city of ['Leesburg, VA', 'Manassas, VA', 'Charles Town, WV', 'Waldorf, MD', 'Frederick, MD']) assert.notEqual(resolve(city).key, dc.key);
  assert.ok(dc.members.some((member) => member.region === 'MD'));
  assert.ok(dc.members.some((member) => member.region === 'VA'));
  assert.ok(!dc.members.some((member) => member.region === 'WV'));
  assert.equal(resolve('Charles Town, WV').key, 'us:market:dc-outer-va-wv');
  assert.deepEqual(resolve('Waldorf, MD').counties, ['24017']);
  assert.deepEqual(resolve('Frederick, MD').counties, ['24021']);
  for (const code of ['11694', '23224', '47764']) assert.ok(!catalog.groups.some((group) => group.key === `division:${code}`), 'residual land cannot retain a misleading official division code');
  assert.notEqual(resolve('New York, NY').key, resolve('Newark, NJ').key);
  assert.equal(resolve('New York, NY').key, resolve('Jersey City, NJ').key);
  assert.equal(new Set(['New York, NY', 'Newark, NJ', 'Hempstead, NY', 'New Brunswick, NJ'].map((city) => resolve(city).key)).size, 4);
  assert.equal(resolve('Islip, NY').key, 'us:division:35004');
  assert.equal(resolve('New Brunswick, NJ').key, 'us:division:29484');
  assert.notEqual(resolve('Los Angeles, CA').key, resolve('Anaheim, CA').key);
  const altoona = resolve('Altoona, AL');
  assert.equal(altoona.centerCountyFips, '01055');
  assert.ok(!altoona.members.some((member) => member.city === 'Altoona'), 'cross-group event city needs verified address');
  assert.ok(resolve('St. Petersburg, FL').members.some((member) => member.city === 'Saint Petersburg'));
  assert.ok(resolve('St. Petersburg, FL').cityAliases.includes('Saint Petersburg'));
  assert.ok(resolve('Orlando, FL').cityCounties.includes('12095'));
  assert.ok(Object.isFrozen(resolve('Orlando, FL').cityCounties));
  assert.ok(!resolve('St. Petersburg, FL').cityAliases.includes('Tampa'), 'city-only aliases never include other places in the metro');
  assert.ok(!resolve('Burbank city, CA').cityAliases.includes('Burbank'), 'ambiguous bare names do not identify one canonical city');
});

test('radius fallback is exactly thirty statute miles from a known city point, never from customer input', () => {
  const marfa = resolve('Marfa, Texas');
  assert.equal(marfa.kind, 'radius');
  assert.equal(marfa.radiusMeters, 48280.32);
  assert.equal(marfa.radiusMiles, 30);
  assert.deepEqual(marfa.center, { latitude: 30.310679, longitude: -104.025452 });
  assert.deepEqual(marfa.counties, []);
  assert.equal(resolve('Gainesville, FL').kind, 'metro'); // Empty metro never expands to radius.
  for (const name of ['Unrecognized City, TX', 'Toronto, Ontario, Canada']) {
    const area = resolve(name);
    assert.equal(area.kind, 'city');
    assert.equal(area.resolutionStatus, 'unresolved');
    assert.equal(area.center, undefined);
  }
  for (const value of ['', 'Marfa', 'All cities, TX', 'Private location, TX', 'Marfa, TX, US, 35']) assert.equal(resolve(value), null);
});

test('city suggestions are bounded, qualified and preserve ambiguous legal names', () => {
  assert.equal(search('').items.length, 0);
  assert.equal(search('Springfield', 100).items.length, 5);
  assert.equal(search('Springfield').items.length, 5);
  assert.equal(search('Springfield').hasMore, true);
  assert.equal(search('Springfield', 2).items.length, 2);
  const scopes = new Set();
  for (const item of search('Springfield').items) {
    assert.match(item.key, /^us:(?:metro|division|radius):\d{5,7}$/);
    assert.match(item.label, /, [A-Z]{2}$/);
    const area = resolve(item.label);
    assert.equal(area.resolutionStatus, 'resolved');
    assert.equal(item.key, area.key);
    assert.ok(!scopes.has(item.key)); scopes.add(item.key);
    assert.equal(item.center, undefined);
  }
  const burbank = search('Burbank, California');
  assert.deepEqual(burbank.items.map((item) => item.label), ['Burbank CDP, CA', 'Burbank city, CA']);
  assert.equal(new Set(burbank.items.map((item) => item.key)).size, 2);
  for (const item of burbank.items) assert.equal(resolve(item.label).key, item.key);
  const ambiguous = search('Bear Valley CDP, California');
  assert.ok(!ambiguous.items.some(item => item.label === 'Bear Valley CDP, CA'), 'identical legal names cannot identify a unique city scope');
  for (const item of ambiguous.items) assert.equal(resolve(item.label).key, item.key);
});

test('suggestions collapse matching suburbs before limiting without widening metro or radius geography', () => {
  for (const [query, label] of [['Miami, FL', 'Miami, FL'], ['Miami Beach, Florida', 'Miami Beach, FL'], ['North Miami, FL', 'North Miami, FL']]) {
    const result = search(query, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].label, label, 'the exact requested place wins within its group');
    assert.equal(result.items[0].key, resolve('Miami, FL').key);
    assert.equal(result.hasMore, false, 'suppressed suburbs do not imply more distinct areas');
  }
  assert.equal(search('Miami').items[0].label, 'Miami, AZ');
  assert.ok(search('Miami').items.some((item) => item.key === resolve('Miami, FL').key));
  assert.equal(search('Fort Lauderdale, FL').items[0].key, resolve('Fort Lauderdale, FL').key);
  assert.notEqual(search('Fort Lauderdale, FL').items[0].key, search('Miami, FL').items[0].key);
  const midway = search('Midway, Arkansas');
  assert.deepEqual(midway.items.map((item) => item.label), ['Midway CDP, AR', 'Midway town, AR']);
  assert.ok(midway.items.every((item) => item.kind === 'radius'));
  assert.equal(new Set(midway.items.map((item) => item.key)).size, 2, 'different thirty-mile centers remain separate');
  assert.equal(midway.hasMore, false);
});

test('complete qualified city matches exclude incidental state-name matches while partial and multi-state choices remain', () => {
  for (const label of ['New York, NY', 'Orlando, FL', 'Tampa, FL', 'Miami, FL', 'Los Angeles, CA', 'Dallas, TX', 'Atlanta, GA']) {
    const result = search(label);
    assert.deepEqual(result.items.map(item => item.label), [label]);
    assert.equal(result.items[0].key, resolve(label).key);
    assert.equal(result.hasMore, false);
  }
  assert.ok(search('New Y').items.length > 1, 'partial city names still offer distinct areas');
  assert.deepEqual(search('Atlanta, Georgia, United States').items.map(item => item.label), ['Atlanta, GA']);
  assert.deepEqual(search('San Fr, CA').items.map(item => item.label), ['San Francisco, CA'], 'qualified partial city tokens do not search another state');
  assert.deepEqual(search('Toronto, Ontario, Canada'), { items: [], hasMore: false }, 'US-only suggestions do not misrepresent a qualified foreign selection');
  const ambiguousState = search('Springfield');
  assert.equal(ambiguousState.items.length, 5);
  assert.equal(ambiguousState.hasMore, true);
  assert.equal(new Set(ambiguousState.items.map(item => item.region)).size, 5);
  assert.ok(ambiguousState.items.every(item => item.city === 'Springfield'));
});
