const test = require('node:test');
const assert = require('node:assert/strict');
const { venueKey, venueOptions, filterVenues, venueFilter } = require('../src/services/venue-scope');
const { aggregateHierarchy } = require('../src/services/analytics-service');
const { reportDetailQuery } = require('../src/http/business-schemas');
const event = (id, name, address, organizationId = 'proper') => ({ id, title: `${name} Friday`, organizationId, organization: { id: organizationId, name: 'Proper' }, locationId: id, location: { name, addressLine1: address, city: 'Orlando', region: 'FL', countryCode: 'US' } });
const room = event('room', 'Room 22', '114 S Orange Ave');
const duplicate = event('duplicate', 'Room22', '114 S Orange Ave');
const proper = event('proper', 'Proper', '101 E Central Blvd');

test('physical venues stay distinct within one organization; duplicate import locations consolidate', () => {
  assert.equal(venueKey(room), venueKey(duplicate));
  assert.notEqual(venueKey(room), venueKey(proper));
  assert.notEqual(venueKey(room), venueKey({ ...room, organizationId: 'other-org' }));
  const options = venueOptions([room, duplicate, proper]);
  assert.equal(options.length, 2);
  assert.deepEqual(options.find(o => o.label === 'Room 22').locationIds, ['room', 'duplicate']);
  assert.equal(venueKey({}), null);
});
test('analytics groups retain custom address filters but editor defaults include only linked locations', () => {
  const custom = { ...room, isManagedVenue: false, location: { ...room.location, timezone: 'America/Denver', privacy: 'private' } };
  const linkedLocation = { ...duplicate.location, timezone: 'America/New_York', privacy: 'public' };
  const linked = { ...duplicate, isManagedVenue: true, location: { ...linkedLocation, toJSON: () => linkedLocation } };
  const options = venueOptions([custom, linked, linked, { ...proper, isManagedVenue: false }]);
  const mixed = options.find(option => option.id === venueKey(room));
  assert.deepEqual(mixed.locationIds, ['room', 'duplicate'], 'all physical-location IDs remain valid analytics filters');
  assert.deepEqual(mixed.managedLocationIds, ['duplicate']);
  assert.deepEqual(mixed.managedLocation, { ...linkedLocation, id: 'duplicate' }, 'linked defaults use the saved row metadata rather than a custom event snapshot');
  assert.equal(mixed.location, custom.location, 'analytics location metadata is preserved');
  const unlinked = options.find(option => option.id === venueKey(proper));
  assert.deepEqual(unlinked.managedLocationIds, []);
  assert.equal(unlinked.managedLocation, null);
});
test('venue multiselect accepts either, both, or all, and never widens authorized input', () => {
  const events = [room, duplicate, proper];
  assert.deepEqual(filterVenues(events, [venueKey(room)]).map(e => e.id), ['room', 'duplicate']);
  assert.deepEqual(filterVenues(events, [venueKey(proper)]), [proper]);
  assert.deepEqual(filterVenues(events, [venueKey(room), venueKey(proper)]), events);
  assert.deepEqual(filterVenues(events, []), events);
  assert.deepEqual(filterVenues([proper], [venueKey(room)]), []);
  assert.deepEqual(reportDetailQuery.parse({ venueIds: venueKey(room) }).venueIds, [venueKey(room)]);
  assert.deepEqual(reportDetailQuery.parse({ venueIds: [venueKey(room), venueKey(proper)] }).venueIds, [venueKey(room), venueKey(proper)]);
  assert.equal(reportDetailQuery.safeParse({ venueIds: 'invalid' }).success, false);
});
test('business venue drilldowns reconcile while admin organization grouping stays unchanged', () => {
  const orders = [room, proper].map((e, i) => ({ eventId: e.id, buyerUserId: `buyer${i}`, subtotalCents: (i + 1) * 1000, paidAt: '2026-09-22', items: [] }));
  const report = aggregateHierarchy([room, proper], orders, { venueEntities: true, includeCustomers: true });
  const venues = report.hierarchy.filter(r => r.kind === 'venue');
  assert.deepEqual(venues.map(r => r.label).sort(), ['Proper', 'Room 22']);
  assert.equal(venues.reduce((sum, r) => sum + r.salesCents, 0), report.summary.salesCents);
  assert.equal(report.summary.salesCents, 3000);
  const admin = aggregateHierarchy([room, proper], orders, { admin: true });
  assert.equal(admin.hierarchy.filter(r => r.kind === 'organization').length, 1);
});
test('SQL venue selections retain organization or creator identity at shared physical locations', () => {
  const other = { ...room, organizationId: 'other-org' };
  const creator = { ...room, organizationId: null, creatorUserId: 'creator-a' };
  const options = venueOptions([room, other, creator]);
  const organization = venueFilter(options, [venueKey(room)]);
  assert.match(organization.sql, /e.organization_id = :venueOwner0/);
  assert.equal(organization.values.venueOwner0, 'proper');
  assert.deepEqual(organization.values.venueLocations0, ['room']);
  const independent = venueFilter(options, [venueKey(creator)]);
  assert.match(independent.sql, /e.organization_id IS NULL AND e.creator_user_id/);
  assert.equal(independent.values.venueOwner0, 'creator-a');
  assert.equal(venueFilter(options, ['unknown']).sql, 'FALSE');
});
