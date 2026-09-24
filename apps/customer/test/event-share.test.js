import test from 'node:test';
import assert from 'node:assert/strict';
import { eventIdFromSearch, eventShareUrl } from '../src/lib/event-share.js';
import { referralFromSearch, referralCodeForEvent } from '../src/lib/referral.js';

test('a shared event URL opens the exact event without requiring a referral', () => {
  const url = eventShareUrl('event-a', 'https://nitewide-demo.onrender.com');
  assert.equal(url, 'https://nitewide-demo.onrender.com/?event=event-a');
  assert.equal(eventIdFromSearch(new URL(url).search), 'event-a');
  assert.equal(referralFromSearch(new URL(url).search), null);
});

test('sharing an event preserves only its active referral attribution', () => {
  const referral = { eventId: 'event-a', code: 'SAM-42' };
  const url = eventShareUrl('event-a', 'https://nitewide-demo.onrender.com', referralCodeForEvent(referral, 'event-a'));
  assert.deepEqual(referralFromSearch(new URL(url).search), referral);
  assert.equal(referralCodeForEvent(referral, 'event-b'), undefined);
  assert.equal(eventShareUrl('event-b', 'https://nitewide-demo.onrender.com', referralCodeForEvent(referral, 'event-b')), 'https://nitewide-demo.onrender.com/?event=event-b');
});

test('event ids and codes are safely encoded in share links', () => {
  const url = eventShareUrl('event/a & b', 'https://nitewide-demo.onrender.com', 'A+B & C');
  assert.equal(new URL(url).searchParams.get('event'), 'event/a & b');
  assert.equal(new URL(url).searchParams.get('ref'), 'A+B & C');
  assert.equal(eventIdFromSearch('?saved=1'), null);
});
