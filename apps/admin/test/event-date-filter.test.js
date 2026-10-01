import test from 'node:test';
import assert from 'node:assert/strict';
import { eventDateFilter } from '../src/lib/event-date-filter.js';

test('event date changes use browser-local timezone and reset pagination', () => {
  assert.deepEqual(eventDateFilter('2026-10-01', '2026-10-10', 'America/New_York'), { startDate: '2026-10-01', endDate: '2026-10-10', timezone: 'America/New_York', page: 1 });
  assert.equal(eventDateFilter('', '2026-10-10', 'America/New_York').startDate, null);
  assert.equal(eventDateFilter('2026-10-01', '', 'America/New_York').endDate, null);
  assert.throws(() => eventDateFilter('2026-10-10', '2026-10-01'), /End date must be/);
});
test('clearing event dates removes both date fields and the timezone scope', () => {
  assert.deepEqual(eventDateFilter(), { startDate: null, endDate: null, timezone: null, page: 1 });
});
