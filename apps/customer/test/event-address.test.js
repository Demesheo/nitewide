import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eventAddress, eventAddressLines } from '../src/lib/presentation.js';

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
  assert.deepEqual(eventAddressLines({ privacy: 'private', addressLine1: 'Hidden street', postalCode: '32801', city: 'Orlando', region: 'FL' }), ['Orlando, FL · Exact address shared by the host']);
});
test('event details place the city, state, postal code, and country below the street', () => {
  assert.deepEqual(eventAddressLines({ privacy: 'public', addressLine1: '123 Orange Ave', addressLine2: 'Suite 2', city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US' }), ['123 Orange Ave, Suite 2', 'Orlando, FL 32801, US']);
  assert.deepEqual(eventAddressLines({ city: 'Orlando', region: 'FL' }), ['Orlando, FL']);
  assert.deepEqual(eventAddressLines(null), ['Address not available yet']);
});
test('event details pair Save and Lucide Share controls beside the split address', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /eventAddressLines\(selected\.location\)\.map/);
  assert.match(app, /className="detail-location-actions"[\s\S]*?onClick=\{\(\) => save\(selected\)\}[\s\S]*?className="save-button event-share-button"[\s\S]*?<Share size=\{18\}/);
  assert.match(css, /\.detail-location-copy\s*\{[^}]*gap: 2px;/);
  assert.match(css, /\.detail-location small\s*\{[^}]*gap: 2px;/);
});
