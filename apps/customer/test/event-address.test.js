import test from 'node:test';
import assert from 'node:assert/strict';
import { eventAddress } from '../src/lib/presentation.js';

test('ticket detail formats the full venue address including suite and postal code', () => {
  assert.equal(eventAddress({ privacy: 'public', addressLine1: '123 Orange Ave', addressLine2: 'Suite 2', city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US' }), '123 Orange Ave, Suite 2, Orlando, FL 32801, US');
});
test('ticket address gracefully handles missing fields', () => {
  assert.equal(eventAddress(null), 'Address not available yet');
  assert.equal(eventAddress({}), 'Address not available yet');
  assert.equal(eventAddress({ city: 'Orlando', region: 'FL' }), 'Orlando, FL');
});
test('private locations do not expose street or postal code', () => {
  assert.equal(eventAddress({ privacy: 'private', addressLine1: 'Hidden street', postalCode: '32801', city: 'Orlando', region: 'FL' }), 'Orlando, FL · Exact address shared by the host');
});
