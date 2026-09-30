const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('./support/http-client.cjs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createFixture, cleanupFixture } = require('./admissions-fixture.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');

function localDay(event) {
  const timezone = event.location?.timezone || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.startsAt));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function compareListings(a, b) {
  return localDay(a).localeCompare(localDay(b))
    || Number(Boolean(b.isPremiumHost)) - Number(Boolean(a.isPremiumHost))
    || (a.title || '').localeCompare(b.title || '', 'en', { sensitivity: 'base', numeric: true })
    || String(a.id).localeCompare(String(b.id));
}

test('public discovery cursor pages preserve global listing order, filters, and keyset behavior beyond 100 events', async () => {
  assertManagedTestDatabase();
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
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

    const filters = new URLSearchParams({ pageSize: '9', startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' });
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
    assert.deepEqual(all.map((item) => item.id), [...all].sort(compareListings).map((item) => item.id), 'ordering remains global across boundaries: venue-local day, Premium, numeric/base title, ID');
    assert.ok(all.some((item) => item.title.startsWith('Night 2')) && all.some((item) => item.title.startsWith('Night 10')));
    assert.ok(all.some((item) => item.title.startsWith('Nïght')), 'base-strength title collation matches customer listing order');
    assert.ok(all.some((item) => item.isPremiumHost) && all.some((item) => !item.isPremiumHost));

    const target = savedEvents[117];
    const targetDay = localDay({ startsAt: target.startsAt, location: { timezone: locations[117].timezone } });
    const combined = new URLSearchParams({
      pageSize: '9', city: locations[117].city, startDate: targetDay, endDate: targetDay,
      query: 'needle', category: 'rock', timezone: 'America/New_York',
    });
    const filtered = await request(`/events?${combined}`);
    assert.equal(filtered.status, 200, JSON.stringify(filtered));
    assert.deepEqual(filtered.data.items.map((item) => item.id), [target.id], 'city, date, text search, and category compose before pagination');
    const cityOnly = await request(`/events?${new URLSearchParams({ pageSize: '9', city: locations[149].city, startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' })}`);
    assert.deepEqual(cityOnly.data.items.map((item) => item.id), [savedEvents[149].id], 'city filtering still works across a broad city dimension');
    const categoryOnly = await request(`/events?${new URLSearchParams({ pageSize: '9', category: 'rock', startDate: '2031-11-02', endDate: '2031-11-09', timezone: 'America/New_York' })}`);
    assert.ok(categoryOnly.data.items.some((item) => item.id === target.id));
    assert.equal((await request(`/events/${target.id}`)).status, 200, 'direct event deep links remain available');
    const mismatch = new URLSearchParams(filters);
    mismatch.set('city', 'Other city'); mismatch.set('cursor', first.data.nextCursor);
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
