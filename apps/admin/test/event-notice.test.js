import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresEventNotice } from '../src/lib/event-notice.js';
const event = { status: 'published', startsAt: '2026-10-01T23:00:00Z', endsAt: '2026-10-02T03:00:00Z', locationId: null, location: { id: 'location', name: 'Club', city: 'Orlando', addressLine1: '1 Main St' } };
const payload = { ...event, location: { name: 'Club', city: 'Orlando', addressLine1: '1 Main St' } };
test('spelling and description edits do not trigger attendee notice confirmation', () => {
  assert.equal(Boolean(requiresEventNotice(event, { ...payload, title: 'Corrected title', summary: 'Corrected description' })), false);
});
test('published schedule, venue and cancellation changes require preview confirmation', () => {
  assert.equal(requiresEventNotice(event, { ...payload, startsAt: '2026-10-02T00:00:00Z' }), true);
  assert.equal(requiresEventNotice(event, { ...payload, location: { ...payload.location, city: 'Miami' } }), true);
  assert.equal(requiresEventNotice(event, { ...payload, status: 'cancelled' }), true);
  assert.equal(requiresEventNotice({ ...event, status: 'draft' }, { ...payload, status: 'cancelled' }), false);
});
