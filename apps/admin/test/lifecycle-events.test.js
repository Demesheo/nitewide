import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('Events retains records and visibly labels inherited lifecycle unavailability', () => {
  assert.match(dashboard, /function eventLifecycle\(record\)/);
  assert.match(dashboard, /record\.organization\?\.lifecycleState !== 'active' \|\| record\.organization\?\.status !== 'active'/);
  assert.match(dashboard, /record\.location\?\.lifecycleState !== 'active'/);
  assert.match(dashboard, /record\.creator\.lifecycleState !== 'active' \|\| !record\.creator\.isActive \|\| record\.creator\.onboardingPending/);
  assert.match(dashboard, /\{ label: 'Lifecycle', sortValue: eventLifecycle, render: \(r\) => <Badge value=\{eventLifecycle\(r\)\}\/> \}/);
  assert.match(dashboard, /events: \[\{ label: 'Event'/);
});
