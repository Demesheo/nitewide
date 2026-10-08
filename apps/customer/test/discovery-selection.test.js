import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedDiscoveryScope, discoveryScopeLabel, qualifiedDiscoveryCity } from '../src/lib/discovery-selection.js';

test('client city qualification preserves the requested place without grouping or geocoding', () => {
  assert.equal(qualifiedDiscoveryCity(' Winter Park, Florida '), 'Winter Park, FL');
  assert.equal(qualifiedDiscoveryCity('St. Petersburg, US-FL, USA'), 'St. Petersburg, FL');
  assert.equal(qualifiedDiscoveryCity('Springfield, Illinois'), 'Springfield, IL');
  assert.equal(qualifiedDiscoveryCity('Toronto, Ontario, Canada'), 'Toronto, ON, CA');
  assert.equal(qualifiedDiscoveryCity('Paris, Île-de-France, FR'), 'Paris, Île-de-France, FR');
  for (const selection of ['', 'Orlando', 'All cities, FL', 'Orlando, unknown', 'Toronto, ON', 'A, FL, US, extra', 'A\nB, FL', null]) {
    assert.equal(qualifiedDiscoveryCity(selection), '');
  }
});

test('server metadata explains metro divisions and city-center radius without implying precise user location', () => {
  assert.equal(discoveryScopeLabel({ kind: 'division', label: 'Miami Beach, FL', groupLabel: 'Miami–Miami Beach–Kendall, FL' }), 'Miami–Miami Beach–Kendall, FL metro division and surrounding communities');
  assert.equal(discoveryScopeLabel({ kind: 'metro', label: 'Winter Park, FL', groupLabel: 'Orlando–Kissimmee–Sanford, FL' }), 'Orlando–Kissimmee–Sanford, FL metro area and surrounding communities');
  assert.equal(discoveryScopeLabel({ kind: 'radius', label: 'A, TX', city: 'A', centerLabel: 'A, TX', radiusMiles: 30 }), 'Within 30 miles of A, TX city center');
  assert.equal(discoveryScopeLabel({ kind: 'city', label: 'Toronto, ON, CA' }), 'Toronto, ON, CA');
  assert.equal(discoveryScopeLabel(null), '');
});

test('a qualified label alone never confirms nearby coverage', () => {
  const area = { key: 'place:12345', label: 'A, TX' };
  assert.equal(confirmedDiscoveryScope(area, 'resolved'), true);
  assert.equal(confirmedDiscoveryScope(area, 'unresolved'), false);
  assert.equal(confirmedDiscoveryScope(area, null), false);
  assert.equal(confirmedDiscoveryScope(null, 'resolved'), false);
  assert.equal(confirmedDiscoveryScope({ label: 'A, TX' }, 'resolved'), false);
});
