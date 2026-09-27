import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingFromSearch } from '../src/lib/booking-link.js';

const id = '61daf017-d30c-4030-9b89-dd29d875ddaf';
test('purchase and guestlist email links resolve only to a booking owned by the signed-in user', () => {
  assert.deepEqual(bookingFromSearch(`?booking=purchase:${id}`), { type: 'booking', kind: 'purchase', id });
  assert.deepEqual(bookingFromSearch(`?booking=guestlist:${id}`), { type: 'booking', kind: 'guestlist', id });
  assert.equal(bookingFromSearch('?booking=purchase:../../admin'), null);
  assert.equal(bookingFromSearch(`?booking=purchase:${id}:other`), null);
});
