import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEventListings, filterUpcomingWeek } from '../src/lib/discovery.js';
import { upcomingSavedEvents } from '../src/lib/saved-events.js';

const event = (id, title, startsAt, premium = false, timezone = 'America/New_York') => ({
  id, title, startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
  isPremiumHost: premium, location: { timezone },
});
const fixtures = [
  event('next', 'Next day Premium', '2026-09-26T22:00:00Z', true),
  event('free', 'Early free', '2026-09-25T19:00:00Z'),
  event('z', 'Zebra Premium', '2026-09-25T20:00:00Z', true),
  event('a', 'Alpha Premium', '2026-09-26T03:00:00Z', true),
];
test('days stay chronological; Premium hosts lead each day regardless of time', () => {
  assert.deepEqual([...fixtures].sort(compareEventListings).map(e => e.id), ['a', 'z', 'free', 'next']);
});
test('calendar-day grouping respects venue timezones rather than UTC day', () => {
  const lateFriday = event('fri', 'Friday', '2026-09-26T06:00:00Z', false, 'America/Los_Angeles');
  const earlySaturday = event('sat', 'Saturday Premium', '2026-09-26T04:30:00Z', true);
  assert.deepEqual([earlySaturday, lateFriday].sort(compareEventListings).map(e => e.id), ['fri', 'sat']);
});
test('same-tier ties use title and ID, not time', () => {
  const first = event('a', 'Same name', '2026-09-25T23:00:00Z');
  const second = event('b', 'Same name', '2026-09-25T18:00:00Z');
  assert.deepEqual([second, first].sort(compareEventListings).map(e => e.id), ['a', 'b']);
});
test('Saved and upcoming-week discovery share Premium-by-day order', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  const expected = ['a', 'z', 'free', 'next'];
  assert.deepEqual(upcomingSavedEvents(fixtures, fixtures.map(e => e.id), now.getTime()).map(e => e.id), expected);
  assert.deepEqual(filterUpcomingWeek(fixtures, { date: '2026-09-22' }, now).map(e => e.id), expected);
});
