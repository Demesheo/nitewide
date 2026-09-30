import test from 'node:test';
import assert from 'node:assert/strict';
import { eventReportTime } from '../src/lib/report-time.js';

test('Analytics event starts prefer the venue zone and never silently fall back to UTC', () => {
  const startsAt = '2026-10-04T02:00:00.000Z';
  assert.match(eventReportTime({ startsAt, venueTimezone: 'America/New_York' }, 'America/Chicago', 'UTC'), /Oct 3, 2026, 10:00 PM/);
  assert.match(eventReportTime({ startsAt }, 'America/New_York', 'UTC'), /Oct 3, 2026, 10:00 PM/, 'selected linked venue is used with an older API response');
  assert.match(eventReportTime({ startsAt }, undefined, 'America/New_York'), /Oct 3, 2026, 10:00 PM/, 'browser local zone is the final visible fallback');
  assert.match(eventReportTime({ startsAt, venueTimezone: 'Invalid/Zone' }, undefined, 'America/New_York'), /Oct 3, 2026, 10:00 PM/);
  assert.doesNotMatch(eventReportTime({ startsAt }, undefined, 'America/New_York'), /UTC|EDT|EST/);
});
