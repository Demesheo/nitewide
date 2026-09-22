import test from 'node:test';
import assert from 'node:assert/strict';
import { guestlistEventName, guestlistStatusesForEvent, guestlistStatusQuery, recentAndUpcomingGuestlistEvents, reviewableGuestlistEvents } from '../src/lib/guestlists.js';

test('guestlist event names are truncated only after 36 characters', () => {
  assert.equal(guestlistEventName('A'.repeat(36)), 'A'.repeat(36));
  assert.equal(guestlistEventName('A'.repeat(37)), `${'A'.repeat(36)}…`);
});

test('future events cannot offer checked-in or no-show request statuses', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const future = { startsAt: '2026-09-25T22:00:00Z' };
  assert.deepEqual(guestlistStatusesForEvent(future, now).map(({ id }) => id), ['pending', 'confirmed', 'rejected', 'cancelled']);
  assert.ok(guestlistStatusesForEvent({ startsAt: '2026-09-20T22:00:00Z' }, now).some(({ id }) => id === 'checked_in'));
});

test('guestlists include ongoing, future, and events ended within the last 24 hours', () => {
  const now = Date.parse('2026-09-22T03:00:00Z');
  const events = [
    { id: 'future', title: 'Future', startsAt: '2026-09-23T00:00:00Z', endsAt: '2026-09-23T04:00:00Z' },
    { id: 'old', title: 'Old', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-21T02:59:59Z' },
    { id: 'boundary', title: 'Boundary', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-21T03:00:00Z' },
    { id: 'ongoing', title: 'Ongoing', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-22T04:00:00Z' },
  ];
  assert.deepEqual(recentAndUpcomingGuestlistEvents(events, now).map((event) => event.id), ['boundary', 'ongoing', 'future']);
  assert.equal(events[0].id, 'future');
});

test('basic employees and promoters only see guestlist events with review access', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const event = (id, canReviewGuestlist) => ({ id, title: id, canReviewGuestlist, startsAt: '2026-09-25T22:00:00Z', endsAt: '2026-09-26T02:00:00Z' });
  assert.deepEqual(reviewableGuestlistEvents([event('own-referral', true), event('other', false)], now).map((item) => item.id), ['own-referral']);
});

test('guestlist status query supports multiple statuses and all', () => {
  assert.equal(guestlistStatusQuery(['pending', 'confirmed']), 'status=pending&status=confirmed');
  assert.equal(guestlistStatusQuery([]), 'status=all');
});
