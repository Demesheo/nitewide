import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoveryDateRange, filterDiscoveryEvents, filterEvents } from '../src/lib/discovery.js';

const now = new Date(2026, 8, 22, 12);
const event = (id, startsAt, extra = {}) => ({ id, title: id, startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(), location: { city: 'Orlando', timezone: 'America/New_York' }, ...extra });
const fixtures = [
  event('expired-today', '2026-09-22T00:00:00-04:00'),
  event('today', '2026-09-22T21:00:00-04:00'),
  event('tomorrow', '2026-09-23T21:00:00-04:00'),
  event('last-day', '2026-09-28T23:59:00-04:00'),
  event('outside', '2026-09-29T00:00:00-04:00'),
];
test('Discover defaults to seven calendar dates including today, not eight days or all future dates', () => {
  assert.deepEqual(discoveryDateRange('', now), { start: '2026-09-22', end: '2026-09-28' });
  assert.deepEqual(filterDiscoveryEvents(fixtures, {}, now).map(e => e.id), ['today', 'tomorrow', 'last-day']);
  assert.equal(filterEvents(fixtures, {}, now).length, 4, 'Other consumers retain unbounded upcoming behavior');
});
test('explicit selection overrides the default, even beyond the next week; clearing restores it', () => {
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-29' }, now).map(e => e.id), ['outside']);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-22' }, now).map(e => e.id), ['today']);
  assert.equal(filterDiscoveryEvents(fixtures, { date: '' }, now).length, 3);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-30' }, now), []);
});
test('week filtering retains city/search and Premium-first-by-day ordering', () => {
  assert.equal(filterDiscoveryEvents(fixtures, { city: 'Miami' }, now).length, 0);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { query: 'tomorrow' }, now).map(e => e.id), ['tomorrow']);
  const premium = event('premium', '2026-09-22T23:00:00-04:00', { organization: { planTier: 'premium' } });
  assert.deepEqual(filterDiscoveryEvents([...fixtures, premium], {}, now).map(e => e.id), ['premium', 'today', 'tomorrow', 'last-day']);
});
test('default window uses local calendar arithmetic across year, leap-day and DST boundaries', () => {
  for (const [today, expected] of [[new Date(2026, 11, 28, 23, 59), '2027-01-03'], [new Date(2028, 1, 27, 12), '2028-03-04'], [new Date(2026, 9, 30, 12), '2026-11-05']]) {
    assert.equal(discoveryDateRange('', today).end, expected);
  }
});
test('Discover UI starts with no exact date and clearing explicitly restores the week', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /\[date, setDate\] = useState\(""\)/);
  assert.match(app, /filterDiscoveryEvents\(events, filters\)/);
  assert.match(app, /aria-label="Reset to next 7 days"/);
  assert.match(app, /NEXT 7 DAYS/);
});
