import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMultipleRegions } from '../src/lib/analytics-explorer.js';

test('contribution charts use regional data only when multiple regions are available', () => {
  assert.equal(hasMultipleRegions(), false);
  assert.equal(hasMultipleRegions({}), false);
  assert.equal(hasMultipleRegions({ options: { regions: [] } }), false);
  assert.equal(hasMultipleRegions({ options: { regions: ['Orlando'] } }), false);
  assert.equal(hasMultipleRegions({ options: { regions: ['Orlando', 'Miami'] } }), true);
});
