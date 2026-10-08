const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('./support/http-client.cjs');
const { randomUUID } = require('node:crypto');
const { createFixture, cleanupFixture } = require('./admissions-fixture.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

function localDay(event) {
  const timezone = event.location?.timezone || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.startsAt));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function compareListings(a, b) {
  return new Date(a.startsAt) - new Date(b.startsAt)
    || String(a.id).localeCompare(String(b.id));
}

test('public discovery cursor pages preserve global listing order, filters, and keyset behavior beyond 100 events', async () => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const config = getConfig();
  assert.equal(config.NODE_ENV, 'test');
  const sequelize = createSequelize(config);
  const models = initModels(sequelize);
  let fixture;
  let server;
  let locationIds = [];
  let eventIds = [];
  let premiumOrganizationId;
  try {
    await sequelize.authenticate();
    if (process.env.DISCOVERY_EXPLAIN === '1') {
      const query = sequelize.query.bind(sequelize); const explained = new Set();
      sequelize.query = async (sql, options) => {
        if (typeof sql === 'string' && /^\s*SELECT e\.id,to_char\(e\.starts_at/.test(sql)) {
          const sort = sql.includes('ORDER BY event_day."day"') ? 'recommended' : sql.includes('ORDER BY geo.distance_meters') ? 'distance' : 'date';
          if (!explained.has(sort)) {
            explained.add(sort);
            const [result] = await query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`, options);
            const plan = result['QUERY PLAN'][0]; const indexes = new Set();
            const collect = node => { if (node['Index Name']) indexes.add(node['Index Name']); (node.Plans || []).forEach(collect); };
            collect(plan.Plan);
            console.log(`[discovery-plan] ${JSON.stringify({ sort, executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], indexes: [...indexes] })}`);
          }
        }
        return query(sql, options);
      };
    }
    fixture = await createFixture(models, config);
    const { ids } = fixture;
    const locations = Array.from({ length: 220 }, (_, index) => ({
      name: `Discovery Venue ${index}`,
      city: `Cursor City ${String(index).padStart(3, '0')}`,
      region: 'FL', countryCode: 'US', timezone: ['America/New_York', 'America/Los_Angeles', 'Europe/London'][index % 3],
      privacy: 'private', lifecycleState: 'active',
    }));
    const savedLocations = await models.Location.bulkCreate(locations, { returning: true });
    locationIds = savedLocations.map((item) => item.id);
    const premiumOrganization = await models.Organization.create({
      name: 'Cursor Premium Org', slug: `cursor-premium-${randomUUID()}`, planTier: 'premium', status: 'active', lifecycleState: 'active',
      locationId: locationIds[0],
    });
    premiumOrganizationId = premiumOrganization.id;
    const titles = ['Night 2', 'Night 10', 'night 2', 'Nïght 2', 'After 3', 'Set 12', 'Set 3'];
    const rows = Array.from({ length: 150 }, (_, index) => {
      const dateOffset = index % 6;
      const hour = index % 3 === 0 ? 2 : 18;
      const startsAt = new Date(Date.UTC(2031, 10, 3 + dateOffset, hour, index % 60));
      const title = index === 117 ? 'Needle Night 2' : `${titles[index % titles.length]} ${Math.floor(index / titles.length)}`;
      return {
        creatorUserId: ids.owner,
        organizationId: index % 2 === 0 ? premiumOrganization.id : ids.org,
        locationId: locationIds[index],
        title,
        slug: `cursor-event-${index}-${randomUUID()}`,
        summary: index === 117 ? 'needle matching summary' : 'Cursor fixture',
        description: index % 13 === 0 ? 'needle music query fixture' : 'Discovery fixture description',
        category: index === 117 ? 'rock' : index % 2 ? 'music' : 'nightlife',
        status: 'published', lifecycleState: 'active', isDiscoverable: true,
        startsAt, endsAt: new Date(startsAt.getTime() + 4 * 3600000), guestlistCapacity: index % 2 ? 10 : 0,
      };
    });
    const savedEvents = await models.Event.bulkCreate(rows, { returning: true });
    eventIds = savedEvents.map((item) => item.id);
    const app = createApp({ sequelize, models, config });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function request(pathname) {
      const response = await httpRequest(server, `/api${pathname}`);
      return { status: response.status, ...response.body };
    }

    const filters = new URLSearchParams({ pageSize: '9', allCities: 'true', sort: 'date', startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' });
    const first = await request(`/events?${filters}`);
    assert.equal(first.status, 200, JSON.stringify(first));
    assert.equal(first.data.items.length, 9);
    assert.equal(first.data.hasMore, true);
    assert.ok(first.data.nextCursor);
    const pages = [first.data];
    while (pages.at(-1).nextCursor) {
      const query = new URLSearchParams(filters);
      query.set('cursor', pages.at(-1).nextCursor);
      const page = await request(`/events?${query}`);
      assert.equal(page.status, 200, JSON.stringify(page));
      pages.push(page.data);
      assert.ok(pages.length <= 20, 'cursor loop must terminate instead of fetching without bound');
    }
    const all = pages.flatMap((page) => page.items);
    assert.equal(all.length, 150);
    assert.equal(new Set(all.map((item) => item.id)).size, 150, 'no duplicate or skipped IDs across cursor pages');
    assert.deepEqual(all.map((item) => item.id), [...all].sort(compareListings).map((item) => item.id), 'Date orders actual start time then ID, never Premium or venue-local day');
    assert.ok(all.every(item => item.distanceMiles === null), 'intentional all-city scans never fabricate a distance origin');
    assert.ok(all.some((item) => item.title.startsWith('Night 2')) && all.some((item) => item.title.startsWith('Night 10')));
    assert.ok(all.some((item) => item.title.startsWith('Nïght')), 'base-strength title collation matches customer listing order');
    assert.ok(all.some((item) => item.isPremiumHost) && all.some((item) => !item.isPremiumHost));
    const recommendedFilters = new URLSearchParams(filters); recommendedFilters.set('sort', 'recommended');
    const recommendedItems = []; let recommendedCursor;
    do {
      const query = new URLSearchParams(recommendedFilters);
      if (recommendedCursor) query.set('cursor', recommendedCursor);
      const response = await request(`/events?${query}`);
      assert.equal(response.status, 200, JSON.stringify(response));
      recommendedItems.push(...response.data.items); recommendedCursor = response.data.nextCursor;
      assert.ok(recommendedItems.length <= 150, 'recommended keyset walk terminates at the bounded fixture count');
    } while (recommendedCursor);
    assert.deepEqual(recommendedItems.map(item => item.id), [...all].sort((a, b) => localDay(a).localeCompare(localDay(b))
      || Number(Boolean(b.isPremiumHost)) - Number(Boolean(a.isPremiumHost)) || compareListings(a, b)).map(item => item.id),
    'nine-card Recommended pages preserve venue-local days before Premium, then actual time/ID when popularity and distance tie');
    assert.equal(new Set(recommendedItems.map(item => item.id)).size, 150, 'recommended pages have no skipped or duplicated records across all day/Premium boundaries');

    const target = savedEvents[117];
    const targetDay = localDay({ startsAt: target.startsAt, location: { timezone: locations[117].timezone } });
    const combined = new URLSearchParams({
      pageSize: '9', city: `${locations[117].city}, FL`, startDate: targetDay, endDate: targetDay,
      query: 'needle', category: 'rock', timezone: 'America/New_York',
    });
    const filtered = await request(`/events?${combined}`);
    assert.equal(filtered.status, 200, JSON.stringify(filtered));
    assert.deepEqual(filtered.data.items.map((item) => item.id), [target.id], 'city, date, text search, and category compose before pagination');
    const cityOnly = await request(`/events?${new URLSearchParams({ pageSize: '9', city: `${locations[149].city}, FL`, startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' })}`);
    assert.deepEqual(cityOnly.data.items.map((item) => item.id), [savedEvents[149].id], 'city filtering still works across a broad city dimension');
    const categoryOnly = await request(`/events?${new URLSearchParams({ pageSize: '9', allCities: 'true', category: 'rock', startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' })}`);
    assert.ok(categoryOnly.data.items.some((item) => item.id === target.id));
    assert.equal((await request(`/events/${target.id}`)).status, 200, 'direct event deep links remain available');
    const mismatch = new URLSearchParams(filters);
    mismatch.delete('allCities'); mismatch.set('city', 'Other city, FL'); mismatch.set('cursor', first.data.nextCursor);
    assert.equal((await request(`/events?${mismatch}`)).status, 422, 'a cursor cannot be reused with changed filters');
    const invalid = await request('/events?pageSize=101&startDate=2031-11-02&endDate=2031-11-09&timezone=UTC');
    assert.equal(invalid.status, 422, 'oversized requests fail validation rather than becoming an unbounded fetch');
    const overlongRange = await request('/events?pageSize=9&startDate=2031-11-02&endDate=2031-12-10&timezone=UTC');
    assert.equal(overlongRange.status, 422, 'discovery date scans are bounded to 31 days');
    const invalidZone = await request('/events?pageSize=9&startDate=2031-11-02&endDate=2031-11-09&timezone=Not/AZone');
    assert.equal(invalidZone.status, 422);

    // A keyset cursor fixes the position: a new earlier row cannot displace or
    // duplicate page-one records, while an insertion after the cursor is seen.
    const beforeCursor = await request(`/events?${filters}`);
    const beforeRow = await models.Event.create({ ...rows[0], id: randomUUID(), locationId: locationIds[0], organizationId: premiumOrganization.id, title: 'A Before Cursor', slug: `before-${randomUUID()}` });
    const afterStart = new Date(Date.UTC(2031, 10, 9, 18));
    const afterRow = await models.Event.create({ ...rows[1], id: randomUUID(), locationId: locationIds[1], organizationId: ids.org, title: 'ZZZ After Cursor', slug: `after-${randomUUID()}`, startsAt: afterStart, endsAt: new Date(afterStart.getTime() + 4 * 3600000) });
    eventIds.push(beforeRow.id, afterRow.id);
    assert.ok(!beforeCursor.data.items.some((item) => item.id === beforeRow.id));
    let cursor = beforeCursor.data.nextCursor;
    const tail = [];
    while (cursor) {
      const query = new URLSearchParams(filters); query.set('cursor', cursor);
      const page = await request(`/events?${query}`);
      assert.equal(page.status, 200, JSON.stringify(page));
      tail.push(...page.data.items); cursor = page.data.nextCursor;
    }
    assert.ok(tail.some((item) => item.id === afterRow.id), 'a later insertion remains reachable after an established cursor');
    assert.ok(!tail.some((item) => item.id === beforeRow.id), 'a backfill before the cursor does not shift later pages');
    assert.equal(new Set([...beforeCursor.data.items, ...tail].map((item) => item.id)).size, beforeCursor.data.items.length + tail.length);

    // Actual event locations determine the area even when a Premium host's
    // organization defaults to a different city. Private/address-only venues
    // participate without coordinates, and unavailable listings stay excluded.
    const marketLocations = [
      ...Array.from({ length: 10 }, (_, index) => ({ city: 'Orlando', region: index % 2 ? 'Florida' : 'FL', countryCode: 'US' })),
      { city: 'Winter Park', region: 'fl', countryCode: 'US', privacy: 'private', addressLine1: 'Hidden fixture address', postalCode: '32789' },
      { city: 'St. Cloud', region: 'US-FL', countryCode: 'US' },
      { city: 'Miami', region: 'FL', countryCode: 'US' },
      { city: 'Miami Beach', region: 'Florida', countryCode: 'US' },
      { city: 'Tampa', region: 'FL', countryCode: 'US' },
      { city: 'St. Petersburg', region: 'Florida', countryCode: 'US' },
      { city: 'Fort Lauderdale', region: 'FL', countryCode: 'US' },
      { city: 'Hollywood', region: 'FL', countryCode: 'US' },
      { city: 'Orlando', region: 'WV', countryCode: 'US' },
      { city: 'Orlando', region: 'FL', countryCode: 'CA' },
      { city: 'Greater Orlando', region: 'FL', countryCode: 'US' },
      { city: 'Orlando', region: null, countryCode: 'US' },
      { city: 'Toronto', region: 'Ontario', countryCode: 'CA' },
      { city: 'Atlanta', region: 'Georgia', countryCode: 'US' },
      { city: 'Orlando', region: 'FL', countryCode: 'US', lifecycleState: 'suspended' },
      { city: 'Orlando', region: 'FL', countryCode: 'US' },
      { city: 'Orlando', region: 'FL', countryCode: 'US' },
      { city: 'Orlando', region: 'FL', countryCode: 'US' },
    ];
    const marketVenues = await models.Location.bulkCreate(marketLocations.map((location, index) => ({ name: `Area fixture venue ${index}`, timezone: 'America/New_York', privacy: 'public', ...location })), { returning: true });
    locationIds.push(...marketVenues.map((location) => location.id));
    await premiumOrganization.update({ locationId: marketVenues[0].id });
    const marketStart = new Date('2031-11-03T18:00:00Z');
    const marketEvents = await models.Event.bulkCreate(marketVenues.map((location, index) => ({
      ...rows[0], id: randomUUID(), locationId: location.id, organizationId: index === 12 ? premiumOrganization.id : ids.org,
      title: `${index === 12 ? 'A Premium' : 'Z'} Boundary needle ${index}`, slug: `area-${randomUUID()}`,
      startsAt: marketStart, endsAt: new Date(+marketStart + 14400000), category: 'nightlife',
      ...(index === 25 ? { status: 'draft' } : {}), ...(index === 26 ? { isDiscoverable: false } : {}),
      ...(index === 27 ? { endsAt: new Date('2020-11-03T22:00:00Z'), startsAt: new Date('2020-11-03T18:00:00Z') } : {}),
    })), { returning: true });
    eventIds.push(...marketEvents.map((event) => event.id));
    const selection = { pageSize: '3', city: 'Orlando, FL', startDate: '2031-11-03', endDate: '2031-11-03', query: 'boundary needle', timezone: 'America/New_York' };
    const orlandoFirst = await request(`/events?${new URLSearchParams(selection)}`);
    assert.equal(orlandoFirst.status, 200, JSON.stringify(orlandoFirst));
    const { resolveNationalDiscoveryArea } = require('../src/domain/discovery-catalog.cjs');
    assert.equal(orlandoFirst.data.area.key, resolveNationalDiscoveryArea('Orlando, FL').key);
    assert.equal(orlandoFirst.data.area.label, 'Orlando, FL');
    assert.equal(orlandoFirst.data.area.kind, 'metro');
    assert.equal(orlandoFirst.data.resolutionStatus, 'resolved');
    assert.equal(orlandoFirst.data.hasUpcomingAreaEvents, true);
    const localPages = [orlandoFirst.data];
    while (localPages.at(-1).nextCursor) {
      const response = await request(`/events?${new URLSearchParams({ ...selection, cursor: localPages.at(-1).nextCursor })}`);
      assert.equal(response.status, 200, JSON.stringify(response));
      localPages.push(response.data);
      assert.ok(localPages.length <= 5);
    }
    const localItems = localPages.flatMap((page) => page.items);
    assert.deepEqual(new Set(localItems.map((item) => item.id)), new Set(marketEvents.slice(0, 12).map((event) => event.id)), 'exact region/country and nearby locality filters apply before every page');
    assert.ok(!localItems.some((item) => item.isPremiumHost), 'an out-of-area Premium host never consumes a local listing position');
    const winterPark = localItems.find((item) => item.id === marketEvents[10].id);
    assert.equal(winterPark.location.city, 'Winter Park');
    assert.equal(winterPark.location.addressLine1, undefined);
    assert.equal(winterPark.location.postalCode, undefined);
    const samePlaceCursor = await request(`/events?${new URLSearchParams({ ...selection, city: 'Orlando, Florida, US', cursor: orlandoFirst.data.nextCursor })}`);
    assert.equal(samePlaceCursor.status, 200, 'equivalent requested-place aliases share cursor identity');
    const sameAreaCursor = await request(`/events?${new URLSearchParams({ ...selection, city: 'Winter Park, Florida, US', cursor: orlandoFirst.data.nextCursor })}`);
    assert.equal(sameAreaCursor.status, 422, 'the requested place and distance origin bind a cursor even within one metro');
    const wrongAreaCursor = await request(`/events?${new URLSearchParams({ ...selection, city: 'Miami, FL', cursor: orlandoFirst.data.nextCursor })}`);
    assert.equal(wrongAreaCursor.status, 422, 'cursors cannot cross markets');
    for (const change of [{ scope: 'city' }, { sort: 'date' }, { sort: 'distance' }, { mode: 'upcoming', endDate: undefined }]) {
      const query = new URLSearchParams({ ...selection, ...change, cursor: orlandoFirst.data.nextCursor });
      if (change.mode === 'upcoming') query.delete('endDate');
      assert.equal((await request(`/events?${query}`)).status, 422, 'mode, scope and sort cannot change under a cursor');
    }
    const exactWinterPark = await request(`/events?${new URLSearchParams({ ...selection, city: 'Winter Park, FL', scope: 'city', sort: 'distance' })}`);
    assert.equal(exactWinterPark.status, 200, JSON.stringify(exactWinterPark));
    assert.deepEqual(exactWinterPark.data.items.map(item => item.id), [marketEvents[10].id], 'city-only excludes every neighboring metro locality');
    assert.equal(exactWinterPark.data.area.kind, 'city'); assert.equal(exactWinterPark.data.scope, 'city');
    assert.deepEqual(exactWinterPark.data.distanceOrigin, { label: 'Winter Park, FL', kind: 'city-center' });
    assert.equal(exactWinterPark.data.items[0].distanceMiles, null, 'private coordinates never provide a distance');
    const saintPetersburg = await request(`/events?${new URLSearchParams({ ...selection, city: 'Saint Petersburg, FL', scope: 'city' })}`);
    assert.deepEqual(saintPetersburg.data.items.map(item => item.id), [marketEvents[15].id], 'city-only permits verified St./Saint aliases without Tampa');

    for (const [city, expected] of [
      ['Miami Beach, FL', [12, 13]], ['St. Petersburg, FL', resolveNationalDiscoveryArea('Tampa, FL').key === resolveNationalDiscoveryArea('St. Petersburg, FL').key ? [14, 15] : [15]], ['Fort Lauderdale, Florida', [16, 17]],
      ['Orlando, West Virginia', [18]], ['Orlando, FL, CA', [19]], ['Greater Orlando, FL', [20]], ['Toronto, ON, CA', [22]], ['Atlanta, GA', [23]],
    ]) {
      const response = await request(`/events?${new URLSearchParams({ ...selection, city })}`);
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.deepEqual(new Set(response.data.items.map((item) => item.id)), new Set(expected.map((index) => marketEvents[index].id)), city);
    }
    const legacyLocal = await request(`/events?${new URLSearchParams({ city: 'Winter Park, Florida', limit: '3' })}`);
    assert.equal(legacyLocal.status, 200, JSON.stringify(legacyLocal));
    assert.equal(legacyLocal.data.length, 3, 'legacy local filtering occurs before the limit');
    assert.ok(legacyLocal.data.every((item) => marketEvents.slice(0, 12).some((event) => event.id === item.id)));
    for (const city of ['', 'Orlando', 'Toronto, ON']) {
      const response = await request(`/events?${new URLSearchParams({ ...selection, city })}`);
      assert.equal(response.status, 200);
      assert.deepEqual(response.data.items, [], 'unresolved selection never falls back globally');
      assert.equal(response.data.hasUpcomingAreaEvents, null);
      assert.deepEqual((await request(`/events?${new URLSearchParams({ city })}`)).data, []);
    }
    assert.deepEqual((await request('/events')).data, [], 'omitted legacy selection also fails closed');
    const noMatchingDate = await request(`/events?${new URLSearchParams({ ...selection, startDate: '2031-12-01', endDate: '2031-12-01' })}`);
    assert.deepEqual(noMatchingDate.data.items, []);
    assert.equal(noMatchingDate.data.hasUpcomingAreaEvents, true, 'area availability is independent of selected date');
    const noMatchingQuery = await request(`/events?${new URLSearchParams({ ...selection, query: 'unfindable query' })}`);
    assert.deepEqual(noMatchingQuery.data.items, []);
    assert.equal(noMatchingQuery.data.hasUpcomingAreaEvents, true, 'area availability is independent of text search');
    const noMatchingCategory = await request(`/events?${new URLSearchParams({ ...selection, category: 'vip' })}`);
    assert.deepEqual(noMatchingCategory.data.items, []);
    assert.equal(noMatchingCategory.data.hasUpcomingAreaEvents, true, 'area availability is independent of category');
    await models.Location.update({ city: 'Seattle', region: 'WA' }, { where: { id: marketVenues.slice(24).map((venue) => venue.id) } });
    const noAreaEvents = await request(`/events?${new URLSearchParams({ ...selection, city: 'Seattle, WA' })}`);
    assert.deepEqual(noAreaEvents.data.items, []);
    assert.equal(noAreaEvents.data.hasUpcomingAreaEvents, false, 'draft, hidden, expired and suspended-location events do not establish area availability');
    assert.equal((await request(`/events/${marketEvents[12].id}`)).status, 200, 'cross-city direct links remain accessible');
    const batch = await request(`/events/batch?ids=${marketEvents[0].id},${marketEvents[12].id}`);
    assert.deepEqual(batch.data.items.map((item) => item.id), [marketEvents[0].id, marketEvents[12].id], 'saved/batch loading remains independent of discovery selection');

    const suggestions = await request('/discovery/areas?q=San');
    assert.equal(suggestions.status, 200, JSON.stringify(suggestions));
    assert.equal(suggestions.data.items.length, 5); assert.equal(suggestions.data.hasMore, true);
    assert.equal(new Set(suggestions.data.items.map(area => area.key)).size, 5, 'suburbs sharing one resolved area do not repeat suggestions');
    assert.ok(suggestions.data.items.every(area => area.key && area.label && area.region && area.countryCode === 'US'));
    assert.deepEqual((await request('/discovery/areas?q=x')).data, { items: [], hasMore: false });
    const borderVenues = await models.Location.bulkCreate([
      { name: 'Kansas City MO fixture', city: 'Kansas City', region: 'Missouri', countryCode: 'US', timezone: 'America/Chicago', privacy: 'private' },
      { name: 'Kansas City KS fixture', city: 'Kansas City', region: 'KS', countryCode: 'US', timezone: 'America/Chicago', privacy: 'private' },
      { name: 'Kansas City wrong-state fixture', city: 'Kansas City', region: 'Florida', countryCode: 'US', timezone: 'America/New_York', privacy: 'private' },
    ], { returning: true });
    locationIds.push(...borderVenues.map(location => location.id));
    const borderEvents = await models.Event.bulkCreate(borderVenues.map((location, index) => ({ ...rows[0], id: randomUUID(), locationId: location.id,
      title: `Border fixture ${index}`, slug: `border-${randomUUID()}`, organizationId: ids.org,
      startsAt: marketStart, endsAt: new Date(+marketStart + 14400000), category: 'nightlife' })), { returning: true });
    eventIds.push(...borderEvents.map(event => event.id));
    const borderFirst = await request(`/events?${new URLSearchParams({ ...selection, city: 'Kansas City, MO', query: 'border fixture', pageSize: '1' })}`);
    assert.equal(borderFirst.status, 200, JSON.stringify(borderFirst)); assert.equal(borderFirst.data.hasMore, true);
    const changedBorderOrigin = await request(`/events?${new URLSearchParams({ ...selection, city: 'Kansas City, KS', query: 'border fixture', pageSize: '1', cursor: borderFirst.data.nextCursor })}`);
    assert.equal(changedBorderOrigin.status, 422, 'same-named places in two states have distinct distance origins');
    const borderSecond = await request(`/events?${new URLSearchParams({ ...selection, city: 'Kansas City, MO', query: 'border fixture', pageSize: '1', cursor: borderFirst.data.nextCursor })}`);
    assert.equal(borderSecond.status, 200);
    assert.deepEqual(new Set([...borderFirst.data.items, ...borderSecond.data.items].map(item => item.id)), new Set(borderEvents.slice(0, 2).map(event => event.id)), 'membership binds city AND its own state, not selected state or city alone');

    const namedBoundaryPlaces = [
      ['Washington', 'DC'], ['Arlington', 'Virginia'], ['Alexandria', 'VA'], ['Fairfax', 'VA'], ['Bethesda', 'Maryland'], ['Hyattsville', 'MD'],
      ['Leesburg', 'VA'], ['Waldorf', 'MD'], ['Frederick', 'Maryland'], ['Charles Town', 'WV'],
      ['Boston', 'Massachusetts'], ['Cambridge', 'MA'], ['Framingham', 'MA'], ['Salem', 'MA'], ['Portsmouth', 'NH'], ['Dover', 'New Hampshire'],
    ];
    const namedBoundaryVenues = await models.Location.bulkCreate(namedBoundaryPlaces.map(([city, region], index) => ({
      name: `Named boundary venue ${index}`, city, region, countryCode: 'US', timezone: 'America/New_York', privacy: 'private',
    })), { returning: true });
    locationIds.push(...namedBoundaryVenues.map(location => location.id));
    const namedBoundaryEvents = await models.Event.bulkCreate(namedBoundaryVenues.map((location, index) => ({ ...rows[0], id: randomUUID(), locationId: location.id,
      title: `Named boundary fixture ${index}`, slug: `named-boundary-${randomUUID()}`, organizationId: ids.org,
      startsAt: marketStart, endsAt: new Date(+marketStart + 14400000), category: 'nightlife' })), { returning: true });
    eventIds.push(...namedBoundaryEvents.map(event => event.id));
    for (const market of [
      { cities: ['Washington, DC', 'Arlington, VA', 'Bethesda, MD'], key: 'us:market:dc-core', included: [0, 1, 2, 3, 4, 5], excluded: [6, 7, 8, 9] },
      { cities: ['Boston, MA', 'Cambridge, MA'], key: 'us:market:boston-ma', included: [10, 11, 12, 13], excluded: [14, 15] },
    ]) {
      const items = []; let marketCursor; let pageIndex = 0;
      do {
        const city = market.cities[0];
        const response = await request(`/events?${new URLSearchParams({ ...selection, city, query: 'named boundary fixture', pageSize: '2', ...(marketCursor ? { cursor: marketCursor } : {}) })}`);
        assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.area.key, market.key);
        assert.equal(response.data.hasUpcomingAreaEvents, true); items.push(...response.data.items);
        marketCursor = response.data.nextCursor; pageIndex++; assert.ok(pageIndex <= 4, 'bounded custom-market cursor journey terminates');
      } while (marketCursor);
      assert.deepEqual(new Set(items.map(item => item.id)), new Set(market.included.map(index => namedBoundaryEvents[index].id)), 'approved cross-state/custom-market membership applies before each page');
      assert.ok(!items.some(item => market.excluded.some(index => namedBoundaryEvents[index].id === item.id)), 'outer DC counties and New Hampshire never bleed into their core markets');
      const legacy = await request(`/events?${new URLSearchParams({ city: market.cities[0], limit: '100' })}`);
      assert.equal(legacy.status, 200, JSON.stringify(legacy));
      assert.deepEqual(new Set(legacy.data.map(item => item.id)), new Set(market.included.map(index => namedBoundaryEvents[index].id)), 'legacy uses the identical approved custom-market boundary');
    }
    assert.equal((await request(`/events/${namedBoundaryEvents[9].id}`)).status, 200, 'an excluded West Virginia listing still supports direct links');
    assert.equal((await request(`/events/${namedBoundaryEvents[14].id}`)).status, 200, 'a New Hampshire listing stays accessible outside Boston discovery');

    // No-date browsing removes the upper window, while explicit range mode
    // never silently widens. All sorts still filter before each keyset page.
    const upcomingStarts = ['2031-11-03T18:00:00Z', '2031-11-14T18:00:00Z', '2032-02-01T18:00:00Z'];
    const upcomingEvents = await models.Event.bulkCreate(upcomingStarts.map((start, index) => ({ ...rows[0], id: randomUUID(),
      locationId: marketVenues[10].id, organizationId: index === 2 ? premiumOrganization.id : ids.org,
      title: `Long upcoming fixture ${index}`, slug: `long-upcoming-${randomUUID()}`, startsAt: new Date(start),
      endsAt: new Date(Date.parse(start) + 14400000) })), { returning: true });
    eventIds.push(...upcomingEvents.map(event => event.id));
    const upcomingQuery = { pageSize: '1', city: 'Winter Park, FL', mode: 'upcoming', scope: 'city', sort: 'date',
      startDate: '2031-11-03', query: 'long upcoming fixture', timezone: 'America/New_York' };
    const upcomingItems = []; let upcomingCursor;
    do {
      const response = await request(`/events?${new URLSearchParams({ ...upcomingQuery, ...(upcomingCursor ? { cursor: upcomingCursor } : {}) })}`);
      assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.mode, 'upcoming');
      assert.equal(response.data.rankingVersion, null); upcomingItems.push(...response.data.items); upcomingCursor = response.data.nextCursor;
      assert.ok(upcomingItems.length <= 3);
    } while (upcomingCursor);
    assert.deepEqual(upcomingItems.map(item => item.id), upcomingEvents.map(event => event.id), 'upcoming reaches events beyond seven and 31 days without Premium-first reordering');
    const explicitWeek = await request(`/events?${new URLSearchParams({ ...upcomingQuery, mode: 'range', endDate: '2031-11-09', pageSize: '9' })}`);
    assert.deepEqual(explicitWeek.data.items.map(item => item.id), [upcomingEvents[0].id], 'an explicit date range remains an explicit range');
    const relevanceEvents = await models.Event.bulkCreate([1, 40].map((days, index) => ({ ...rows[0], id: randomUUID(),
      locationId: marketVenues[10].id, organizationId: index ? premiumOrganization.id : ids.org,
      title: `Relevance fixture ${index}`, slug: `relevance-${randomUUID()}`, startsAt: new Date(Date.now() + days * 86400000),
      endsAt: new Date(Date.now() + days * 86400000 + 14400000) })), { returning: true });
    eventIds.push(...relevanceEvents.map(event => event.id));
    const relevance = await request(`/events?${new URLSearchParams({ ...upcomingQuery, pageSize: '9', sort: 'recommended', query: 'relevance fixture',
      startDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10) })}`);
    assert.deepEqual(relevance.data.items.map(item => item.id), relevanceEvents.map(event => event.id), 'an earlier day always precedes a later Premium day');

    const rankingEvents = await models.Event.bulkCreate(Array.from({ length: 8 }, (_, index) => ({ ...rows[0], id: randomUUID(),
      locationId: marketVenues[10].id, organizationId: [3, 7].includes(index) ? premiumOrganization.id : ids.org,
      title: `Rank fixture ${index}`, slug: `rank-${randomUUID()}`,
      startsAt: new Date(+marketStart + (index === 3 ? 2 : index === 7 ? 3 : 0) * 3600000),
      endsAt: new Date(+marketStart + 28800000) })), { returning: true });
    eventIds.push(...rankingEvents.map(event => event.id));
    const recentTime = new Date(Date.now() - 60000);
    const attribution = (index, action, extras = {}) => ({ eventId: rankingEvents[index].id, action, occurredAt: recentTime, ...extras });
    const selfReferrer = await models.EventAffiliate.create({ eventId: rankingEvents[6].id, userId: ids.promoter, code: `SELF-${randomUUID()}`, status: 'active' });
    await models.AffiliateAttribution.bulkCreate([
      ...Array.from({ length: 20 }, () => attribution(0, 'visit', { userId: ids.guest })),
      attribution(1, 'purchase', { userId: ids.guest }),
      ...Array.from({ length: 20 }, () => attribution(2, 'purchase', { userId: ids.guest })),
      ...Array.from({ length: 20 }, () => attribution(3, 'checkout', { userId: ids.guest })),
      ...Array.from({ length: 10 }, (_, index) => attribution(4, 'visit', { sessionKey: `visitor-a-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => attribution(5, 'visit', { sessionKey: `visitor-b-${index}` })),
      attribution(6, 'purchase', { userId: ids.owner }),
      attribution(6, 'purchase', { userId: ids.promoter, eventAffiliateId: selfReferrer.id }),
    ]);
    const rankedQuery = { ...selection, city: 'Winter Park, FL', scope: 'city', query: 'rank fixture', pageSize: '2', sort: 'recommended' };
    const rankedFirst = await request(`/events?${new URLSearchParams(rankedQuery)}`);
    assert.equal(rankedFirst.status, 200, JSON.stringify(rankedFirst));
    assert.equal(rankedFirst.data.rankingVersion, 'recommended-v2');
    assert.deepEqual(rankedFirst.data.items.map(item => item.id), [rankingEvents[3].id, rankingEvents[7].id], 'same-day later Premium precedes earlier non-Premium regardless of engagement');
    async function rankedTail(cursor) {
      const items = [];
      while (cursor) {
        const response = await request(`/events?${new URLSearchParams({ ...rankedQuery, cursor })}`);
        assert.equal(response.status, 200, JSON.stringify(response));
        assert.equal(response.data.rankedAsOf, rankedFirst.data.rankedAsOf);
        items.push(...response.data.items); cursor = response.data.nextCursor; assert.ok(items.length <= 6);
      }
      return items;
    }
    const baselineTail = await rankedTail(rankedFirst.data.nextCursor);
    const tiedIds = indexes => indexes.map(index => rankingEvents[index].id).sort();
    assert.deepEqual(baselineTail.map(item => item.id), [...tiedIds([1, 2]), ...tiedIds([4, 5]), rankingEvents[0].id, rankingEvents[6].id],
      'within the same day and host tier, popularity deduplicates actors, caps visits, excludes checkout and creator/referrer self-signals');
    await models.AffiliateAttribution.bulkCreate([
      attribution(6, 'purchase', { userId: ids.guest, createdAt: new Date(Date.parse(rankedFirst.data.rankedAsOf) + 1000) }),
      attribution(6, 'visit', { sessionKey: 'new-post-anchor-visitor', occurredAt: new Date(Date.parse(rankedFirst.data.rankedAsOf) + 1000) }),
    ]);
    assert.deepEqual((await rankedTail(rankedFirst.data.nextCursor)).map(item => item.id), baselineTail.map(item => item.id),
      'post-anchor visits and purchases, including backdated occurredAt, cannot reshuffle an established ranking cursor');
    const freshRank = await request(`/events?${new URLSearchParams({ ...rankedQuery, pageSize: '9' })}`);
    assert.ok(freshRank.data.items.some(item => item.id === rankingEvents[6].id), 'live eligibility stays available without claiming an immutable event snapshot');

    // Current provider county wins over a misleading stored city; unverified
    // legacy coordinates never stand in for a verified physical venue point.
    const radiusArea = resolveNationalDiscoveryArea('Marfa, TX');
    assert.equal(radiusArea.kind, 'radius');
    const { QueryTypes } = require('sequelize');
    const projected = await sequelize.query(`SELECT distance,
      ST_Y(ST_Project(ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326)::geography,distance,0)::geometry) AS latitude,
      ST_X(ST_Project(ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326)::geography,distance,0)::geometry) AS longitude
      FROM (VALUES (48280.32-10),(48280.32+10)) AS distances(distance)`,
    { replacements: { ...radiusArea.center }, type: QueryTypes.SELECT });
    const geographyRows = [
      { city: 'Uncatalogued Orlando fixture', region: 'FL', latitude: 28.538, longitude: -81.379, county: '12095' },
      { city: 'Orlando', region: 'FL', latitude: 25.761, longitude: -80.191, county: '12086' },
      { city: 'Marfa', region: 'TX', ...projected[0], county: '48377' },
      { city: 'Nearby unknown town', region: 'TX', ...projected[1], county: '48377' },
      { city: 'Marfa', region: 'TX', latitude: radiusArea.center.latitude, longitude: radiusArea.center.longitude, unverified: true },
    ];
    const geographyLocations = await models.Location.bulkCreate(geographyRows.map((row, index) => ({ city: row.city, region: row.region, countryCode: 'US',
      name: `Geography fixture ${index}`, addressLine1: `100${index} Fixture Street`, postalCode: row.region === 'TX' ? '79843' : '32801',
      timezone: row.region === 'TX' ? 'America/Chicago' : 'America/New_York', privacy: 'public',
      ...(row.unverified ? { latitude: row.latitude, longitude: row.longitude, geo: { type: 'Point', coordinates: [row.longitude, row.latitude] } } : {}) })), { returning: true });
    locationIds.push(...geographyLocations.map(location => location.id));
    await sequelize.query("UPDATE locations SET geocode_status='unverified' WHERE id=:id", { replacements: { id: geographyLocations[4].id } });
    const geographyByAddress = new Map(geographyLocations.map((location, index) => [location.addressLine1, geographyRows[index]]));
    const { createLocationGeocodingService } = require('../src/services/location-geocoding-service');
    const mockedWorker = createLocationGeocodingService({ sequelize, batchSize: 20, geocoder: { enabled: true, geocode: async location => {
      const row = geographyByAddress.get(location.addressLine1);
      return !row || row.unverified ? { status: 'unmatched' } : { status: 'matched', latitude: Number(Number(row.latitude).toFixed(6)), longitude: Number(Number(row.longitude).toFixed(6)),
        countyFips: row.county, benchmark: 'mock-benchmark', vintage: 'mock-vintage' };
    } } });
    assert.ok(await mockedWorker.drain() >= 4); await mockedWorker.stop();
    const geographyEvents = await models.Event.bulkCreate(geographyLocations.map((location, index) => ({ ...rows[0], id: randomUUID(), locationId: location.id,
      title: `Geography fixture ${index}`, slug: `geography-${randomUUID()}`, organizationId: ids.org,
      startsAt: marketStart, endsAt: new Date(+marketStart + 14400000), category: 'nightlife' })), { returning: true });
    eventIds.push(...geographyEvents.map(event => event.id));
    const geographySelection = { ...selection, query: 'geography fixture', pageSize: '2' };
    const countyLocal = await request(`/events?${new URLSearchParams(geographySelection)}`);
    assert.deepEqual(countyLocal.data.items.map(item => item.id), [geographyEvents[0].id], 'verified physical county includes unknown localities and excludes a false city alias');
    assert.equal(countyLocal.data.items[0].location.geocodeAddressHash, undefined);
    assert.equal(countyLocal.data.items[0].location.countyFips, undefined);
    const radiusQuery = { ...geographySelection, city: 'Marfa, TX' };
    const radiusPage = await request(`/events?${new URLSearchParams(radiusQuery)}`);
    assert.equal(radiusPage.status, 200, JSON.stringify(radiusPage));
    assert.deepEqual(radiusPage.data.items.map(item => item.id), [geographyEvents[2].id], 'the 30-mile boundary uses complete current provider geography before pagination');
    assert.equal(radiusPage.data.area.radiusMiles, 30); assert.equal(radiusPage.data.hasUpcomingAreaEvents, true);
    const distanceQuery = { ...geographySelection, city: 'Orlando, FL', scope: 'city', sort: 'distance', pageSize: '1' };
    // Exact city text is necessary, but must not override current provider
    // evidence proving that a venue is outside all of that place's counties.
    const physicalDistance = await request(`/events?${new URLSearchParams(distanceQuery)}`);
    assert.equal(physicalDistance.status, 200, JSON.stringify(physicalDistance));
    assert.deepEqual(physicalDistance.data.items, [], 'a verified Miami address cannot reenter Orlando through misleading city text');
    assert.equal((await request(`/events/${geographyEvents[1].id}`)).status, 200, 'excluded physical geography remains available by direct link');
    const marfaCityDistance = await request(`/events?${new URLSearchParams({ ...radiusQuery, scope: 'city', sort: 'distance', pageSize: '1' })}`);
    assert.deepEqual(marfaCityDistance.data.items.map(item => item.id), [geographyEvents[2].id]);
    assert.ok(marfaCityDistance.data.items[0].distanceMiles > 29 && marfaCityDistance.data.items[0].distanceMiles <= 30);
    assert.equal(marfaCityDistance.data.hasMore, true);
    const unknownDistanceTail = await request(`/events?${new URLSearchParams({ ...radiusQuery, scope: 'city', sort: 'distance', pageSize: '1', cursor: marfaCityDistance.data.nextCursor })}`);
    assert.deepEqual(unknownDistanceTail.data.items.map(item => item.id), [geographyEvents[4].id]);
    assert.equal(unknownDistanceTail.data.items[0].distanceMiles, null, 'unverified venues remain after known distances rather than acquiring fake zero distance');
    const recommendedProximity = await request(`/events?${new URLSearchParams({ ...radiusQuery, scope: 'city', pageSize: '9' })}`);
    assert.deepEqual(recommendedProximity.data.items.map(item => item.id), [geographyEvents[2].id, geographyEvents[4].id], 'known distance precedes unavailable distance only when day, Premium and popularity tie');
    await models.AffiliateAttribution.create({ eventId: geographyEvents[4].id, action: 'purchase', userId: ids.guest, occurredAt: recentTime });
    const popularityFirst = await request(`/events?${new URLSearchParams({ ...radiusQuery, scope: 'city', pageSize: '1' })}`);
    assert.deepEqual(popularityFirst.data.items.map(item => item.id), [geographyEvents[4].id], 'popularity takes priority over known city-center proximity');
    assert.equal(popularityFirst.data.items[0].distanceMiles, null);
    const popularityTail = await request(`/events?${new URLSearchParams({ ...radiusQuery, scope: 'city', pageSize: '1', cursor: popularityFirst.data.nextCursor })}`);
    assert.deepEqual(popularityTail.data.items.map(item => item.id), [geographyEvents[2].id], 'cursor crosses popularity then nullable-distance boundaries without losing known locations');
    const legacyRadius = await request('/events?city=Marfa%2C%20TX&limit=1');
    assert.equal(legacyRadius.status, 200, JSON.stringify(legacyRadius)); assert.deepEqual(legacyRadius.data.map(item => item.id), [geographyEvents[2].id]);
    await models.Location.update({ addressLine1: 'Changed Fixture Street' }, { where: { id: geographyLocations[2].id } });
    const invalidated = await models.Location.findByPk(geographyLocations[2].id);
    assert.equal(invalidated.geocodeStatus, 'pending'); assert.equal(invalidated.geo, null); assert.equal(invalidated.countyFips, null);
    const invalidatedPage = await request(`/events?${new URLSearchParams(radiusQuery)}`);
    assert.deepEqual(invalidatedPage.data.items, []); assert.equal(invalidatedPage.data.hasUpcomingAreaEvents, null, 'pending nearby geography is not a confirmed absence of events');
    assert.equal((await request(`/events/${geographyEvents[2].id}`)).status, 200, 'coordinate invalidation does not disable direct event links');
    const { locationAddressHash } = require('../src/domain/location-geography');
    const hashInput = { addressLine1: '\t100  Fixture\nStreet ', addressLine2: 'Unit 5', city: ' ORLANDO ', region: 'Florida', postalCode: '32801', countryCode: 'US' };
    const [sqlHash] = await sequelize.query('SELECT location_address_hash(:addressLine1,:addressLine2,:city,:region,:postalCode,:countryCode) AS hash', { replacements: hashInput, type: QueryTypes.SELECT });
    assert.equal(sqlHash.hash, locationAddressHash(hashInput), 'database and cache fingerprints agree on address normalization');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (eventIds.length) await models.Event.destroy({ where: { id: eventIds } });
    if (premiumOrganizationId) await models.OrganizationVenue.destroy({ where: { organizationId: premiumOrganizationId } });
    if (premiumOrganizationId) await models.Organization.destroy({ where: { id: premiumOrganizationId } });
    if (locationIds.length) await models.Location.destroy({ where: { id: locationIds } });
    if (fixture) await cleanupFixture(models, fixture);
    await sequelize.close();
  }
});
