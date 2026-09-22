const test = require('node:test');
const assert = require('node:assert/strict');
const { matchVenue, firstNonOverlapping } = require('../src/db/seed-venue-policy');
const { validateSnapshot } = require('../src/db/posh-importer');
const snapshot = require('../src/db/fixtures/posh-orlando-2026-09-22');
test('venue aliases match punctuation, spaces and prefixes but require Orlando', () => {
  for (const [name, expected] of [['ROOM 22 Show Bar', 'room-22'], ['Sessions Orlando', 'sessions'], ['The Robinson Cocktail Room','robinson'], ['Bullit and McQueens','mcqueens'], ['TACO KAT','taco-kat'],['Elixir Orlando','elixir']]) assert.equal(matchVenue(name,'Orlando, FL'),expected);
  assert.equal(matchVenue('Elixir','Miami, FL'), null);
  assert.equal(matchVenue('Sessions and Elixir','Orlando, FL'), null);
});
test('expanded public snapshot is valid and first overlapping source wins per physical venue', () => {
  validateSnapshot(snapshot);
  assert.equal(snapshot.events.length, 37);
  const selected = firstNonOverlapping(snapshot.events);
  assert.ok(selected.skipped.length >= 5);
  const afterParty = selected.kept.find(e => e.sourceUrl.endsWith('ucf-official-latin-tailgate-after-party'));
  assert.ok(afterParty);
  assert.ok(selected.skipped.some(({event}) => event.sourceUrl.endsWith('viejo-reggaeton-saturdays-free-rsvp-b4-1130pm-2026-9-27-6-30')));
  for (const event of snapshot.events) assert.equal(matchVenue(snapshot.venues[event.venueSlug].sourceName,`${snapshot.venues[event.venueSlug].addressLine1}, Orlando, FL`),event.venueSlug);
  const a = { venueSlug:'proper',startsAt:'2026-10-02T22:00:00-04:00',endsAt:'2026-10-03T02:00:00-04:00' };
  assert.equal(firstNonOverlapping([a,{...a,venueSlug:'room-22'}]).kept.length,2);
});
