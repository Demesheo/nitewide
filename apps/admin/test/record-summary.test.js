import test from 'node:test';
import assert from 'node:assert/strict';
import { recordCount, recordStatuses, humanLabel } from '../src/lib/record-summary.js';

test('single results use human singular counts', () => {
  assert.equal(recordCount(1, 'users'), '1 person'); assert.equal(recordCount(2, 'users'), '2 people');
  assert.equal(recordCount(1, 'organizations'), '1 business'); assert.equal(recordCount(1, 'events'), '1 event');
  assert.equal(recordCount(0, 'users'), '0 people'); assert.equal(humanLabel('admin'), 'Manager');
});
test('People lifecycle takes precedence over the legacy active flag without contradictory states', () => {
  assert.deepEqual(recordStatuses({ isActive: true, lifecycleState: 'suspended' }, 'users'), ['suspended']);
  assert.deepEqual(recordStatuses({ isActive: true, lifecycleState: 'archived' }, 'users'), ['archived']);
  assert.deepEqual(recordStatuses({ isActive: false, lifecycleState: 'active' }, 'users'), ['disabled']);
  assert.deepEqual(recordStatuses({ status: 'published', lifecycleState: 'suspended' }, 'events'), ['published', 'suspended']);
});
