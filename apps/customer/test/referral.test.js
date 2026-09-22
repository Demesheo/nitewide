import test from 'node:test';
import assert from 'node:assert/strict';
import { referralCodeForEvent, referralFromSearch } from '../src/lib/referral.js';

test('a referral URL is scoped to a single event and survives unrelated query parameters', () => {
  const referral = referralFromSearch('?event=event-a&ref=STAFF-code&other=1');
  assert.deepEqual(referral, { eventId: 'event-a', code: 'STAFF-code' });
  assert.equal(referralCodeForEvent(referral, 'event-a'), 'STAFF-code');
  assert.equal(referralCodeForEvent(referral, 'event-b'), undefined);
});
test('incomplete links never attribute a purchase or guestlist request', () => {
  assert.equal(referralFromSearch('?event=event-a'), null);
  assert.equal(referralFromSearch('?ref=CODE'), null);
  assert.equal(referralCodeForEvent(null, 'event-a'), undefined);
});
