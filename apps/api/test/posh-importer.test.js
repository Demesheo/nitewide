const test = require('node:test');
const assert = require('node:assert/strict');
const snapshot = require('../src/db/fixtures/posh-orlando-2026-09-21');
const { validateSnapshot, upcomingEvents, stableId, assertLocalDemoDatabase, readLimitedImage, demoOfferings } = require('../src/db/posh-importer');
const clone = () => structuredClone(snapshot);
const { matchVenue, firstNonOverlapping } = require('../src/db/seed-venue-policy');
const expandedSnapshot = require('../src/db/fixtures/posh-orlando-2026-09-22');

test('verified Orlando fixture has bounded, unique occurrences with explicit Eastern times', () => {
  const events = validateSnapshot(snapshot);
  assert.equal(events.length, 23);
  assert.equal(new Set(events.map(e => e.venueSlug)).size, 4);
  assert.equal(new Set(events.map(e => e.imageUrl)).size, 11);
  assert.equal(snapshot.venues.tier.name, 'OHM');
  assert.equal(snapshot.venues.tier.previousName, 'Tier');
  const euphoria = events.filter(e => e.venueSlug === 'euphoria-downtown');
  assert.equal(euphoria.length, 4);
  assert.equal(new Date(euphoria[0].startsAt).toISOString(), '2026-09-27T02:00:00.000Z');
  assert.equal(new Date(euphoria[0].endsAt).toISOString(), '2026-09-27T06:00:00.000Z');
  assert.ok(events.every(e => Date.parse(e.endsAt) - Date.parse(e.startsAt) === 4 * 3600000));
});
test('snapshot expires without rolling historic events forward', () => {
  assert.equal(upcomingEvents(snapshot, new Date('2026-09-21T12:00:00Z')).length, 23);
  assert.equal(upcomingEvents(snapshot, new Date('2026-11-01T00:00:00Z')).length, 0);
  const first = new Date(snapshot.events[0].startsAt);
  assert.ok(upcomingEvents(snapshot, first).some(e => e.sourceUrl === snapshot.events[0].sourceUrl));
  assert.ok(!upcomingEvents(snapshot, new Date(first.getTime() + 1)).some(e => e.sourceUrl === snapshot.events[0].sourceUrl));
});
test('invalid source, dates, duplicate occurrence and unknown venue fail validation', () => {
  for (const mutate of [
    s => { s.events[0].sourceUrl = 'https://example.org/event'; },
    s => { s.events[0].imageUrl = 'http://127.0.0.1/image'; },
    s => { s.events[0].startsAt = s.windowEndExclusive; },
    s => { s.events[0].endsAt = s.events[0].startsAt; },
    s => { s.events[0].venueSlug = 'unmatched'; },
    s => { s.city = 'Miami'; },
    s => { s.events.push(s.events[0]); },
  ]) { const s = clone(); mutate(s); assert.throws(() => validateSnapshot(s)); }
});
test('demo import rejects production and remote databases', () => {
  assertLocalDemoDatabase({ NODE_ENV: 'development', DATABASE_URL: 'postgres://localhost/nitewide' });
  assert.throws(() => assertLocalDemoDatabase({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/nitewide' }));
  assert.throws(() => assertLocalDemoDatabase({ NODE_ENV: 'development', DATABASE_URL: 'postgres://db.example.com/nitewide' }));
});
test('remote demo import requires explicit isolated bootstrap authorization', () => {
  const config = { NODE_ENV: 'production', hostedDemo: true, DATABASE_URL: 'postgres://demo.example/nitewide_demo' };
  assert.throws(() => assertLocalDemoDatabase(config));
  assert.doesNotThrow(() => assertLocalDemoDatabase({ ...config, demoBootstrapAuthorized: true }));
  assert.throws(() => assertLocalDemoDatabase({ ...config, demoBootstrapAuthorized: true, DATABASE_URL: 'postgres://demo.example/production' }));
});
test('stable IDs and demo commerce stay separate from source pricing', () => {
  const id = stableId(snapshot.events[0].sourceUrl);
  assert.equal(stableId(snapshot.events[0].sourceUrl), id);
  assert.notEqual(stableId(snapshot.events[1].sourceUrl), id);
  assert.match(id, /^[a-f0-9-]{36}$/);
  const offers = demoOfferings(id, snapshot.events[0].startsAt, new Date());
  assert.deepEqual(offers.map(o => o.priceCents), [1000, 30000, 40000, 100000]);
  assert.ok(offers.every(o => o.description.includes('Demonstration')));
});
test('image downloader is bounded and only requests approved public images', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response(Buffer.from('image'), { headers: { 'content-type': 'image/png' } }); };
  await assert.rejects(readLimitedImage('http://localhost/private', fetchImpl), /Unapproved/);
  assert.equal(calls, 0);
  assert.equal((await readLimitedImage(snapshot.events[0].imageUrl, fetchImpl)).toString(), 'image');
  await assert.rejects(readLimitedImage(snapshot.events[0].imageUrl, async () => new Response('html', { headers: { 'content-type': 'text/html' } })), /unavailable/);
  await assert.rejects(readLimitedImage(snapshot.events[0].imageUrl, async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) } })), /10 MB/);
  await assert.rejects(readLimitedImage(snapshot.events[0].imageUrl, async () => new Response(Buffer.alloc(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })), /10 MB/);
  const png = await require('sharp')({ create: { width:128, height:128, channels:3, background:'#121212' } }).png().toBuffer();
  assert.deepEqual(await readLimitedImage(snapshot.events[0].imageUrl, async () => new Response(png)), png);
  await assert.rejects(readLimitedImage(snapshot.events[0].imageUrl, async () => new Response(Buffer.from('<html>not an image</html>'))), /valid, static/);
});

test('venue aliases match punctuation, spaces and prefixes but require Orlando', () => {
  for (const [name, expected] of [['ROOM 22 Show Bar', 'room-22'], ['Sessions Orlando', 'sessions'], ['The Robinson Cocktail Room','robinson'], ['Bullit and McQueens','mcqueens'], ['TACO KAT','taco-kat'],['Elixir Orlando','elixir']]) assert.equal(matchVenue(name,'Orlando, FL'),expected);
  assert.equal(matchVenue('Elixir','Miami, FL'), null);
  assert.equal(matchVenue('Sessions and Elixir','Orlando, FL'), null);
});
test('expanded public snapshot is valid and first overlapping source wins per physical venue', () => {
  validateSnapshot(expandedSnapshot);
  assert.equal(expandedSnapshot.events.length, 37);
  const selected = firstNonOverlapping(expandedSnapshot.events);
  assert.ok(selected.skipped.length >= 5);
  const afterParty = selected.kept.find(e => e.sourceUrl.endsWith('ucf-official-latin-tailgate-after-party'));
  assert.ok(afterParty);
  assert.ok(selected.skipped.some(({event}) => event.sourceUrl.endsWith('viejo-reggaeton-saturdays-free-rsvp-b4-1130pm-2026-9-27-6-30')));
  for (const event of expandedSnapshot.events) assert.equal(matchVenue(expandedSnapshot.venues[event.venueSlug].sourceName,`${expandedSnapshot.venues[event.venueSlug].addressLine1}, Orlando, FL`),event.venueSlug);
  const a = { venueSlug:'proper',startsAt:'2026-10-02T22:00:00-04:00',endsAt:'2026-10-03T02:00:00-04:00' };
  assert.equal(firstNonOverlapping([a,{...a,venueSlug:'room-22'}]).kept.length,2);
});
