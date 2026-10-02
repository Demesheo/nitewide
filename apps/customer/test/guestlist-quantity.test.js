import test from 'node:test';
import assert from 'node:assert/strict';
import { customerGuestlistMaxPartySize, customerGuestlistPartyLimit, validGuestlistPartySize } from '../src/lib/guestlist-quantity.js';

test('customer requests cap server limits at five while preserving lower limits', () => {
  assert.equal(customerGuestlistMaxPartySize, 5);
  for (const limit of [undefined, null, 0, -1, 1.5, 'invalid', 20, 100]) assert.equal(customerGuestlistPartyLimit(limit), 5);
  assert.equal(customerGuestlistPartyLimit(3), 3);
  assert.equal(customerGuestlistPartyLimit('4'), 4);
});

test('request and approval quantities accept only integers within their respective limits', () => {
  assert.equal(validGuestlistPartySize(1), true);
  assert.equal(validGuestlistPartySize(5), true);
  for (const value of [0, 6, 20, 1.5, NaN, Infinity, '5']) assert.equal(validGuestlistPartySize(value), false);
  assert.equal(validGuestlistPartySize(20, 20), true);
  assert.equal(validGuestlistPartySize(21, 20), false);
});
