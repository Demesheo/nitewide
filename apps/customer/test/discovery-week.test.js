import test from 'node:test';
import assert from 'node:assert/strict';
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
test('undated discovery is upcoming without an arbitrary future cutoff', () => {
  assert.deepEqual(discoveryDateRange('', now), { start: '2026-09-22', end: null });
  assert.deepEqual(filterDiscoveryEvents(fixtures, {}, now).map(e => e.id), ['today', 'tomorrow', 'last-day', 'outside']);
  assert.equal(filterEvents(fixtures, {}, now).length, 4);
});
test('explicit selection overrides the default, even beyond the next week; clearing restores it', () => {
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-29' }, now).map(e => e.id), ['outside']);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-22' }, now).map(e => e.id), ['today']);
  assert.equal(filterDiscoveryEvents(fixtures, { date: '' }, now).length, 4);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { date: '2026-09-30' }, now), []);
});
test('undated fallback retains city/search and Recommended Premium-by-day ordering', () => {
  assert.equal(filterDiscoveryEvents(fixtures, { city: 'Miami' }, now).length, 0);
  assert.deepEqual(filterDiscoveryEvents(fixtures, { query: 'tomorrow' }, now).map(e => e.id), ['tomorrow']);
  const premium = event('premium', '2026-09-22T23:00:00-04:00', { organization: { planTier: 'premium' } });
  assert.deepEqual(filterDiscoveryEvents([...fixtures, premium], {}, now).map(e => e.id), ['premium', 'today', 'tomorrow', 'last-day', 'outside']);
});
test('upcoming anchor uses local calendar arithmetic across year, leap-day and DST boundaries', () => {
  for (const today of [new Date(2026, 11, 28, 23, 59), new Date(2028, 1, 27, 12), new Date(2026, 9, 30, 12)]) {
    const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    assert.deepEqual(discoveryDateRange('', today), { start, end: null });
  }
});
