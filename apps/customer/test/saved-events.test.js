import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingSavedEvents } from '../src/lib/saved-events.js';
test('Saved lists only saved upcoming events, ordered by date without discovery filters', () => {
  const events = [
    { id: 'past', startsAt: '2026-09-20T10:00:00Z' },
    { id: 'later', startsAt: '2026-09-25T10:00:00Z' },
    { id: 'next', startsAt: '2026-09-23T10:00:00Z' },
    { id: 'unsaved', startsAt: '2026-09-24T10:00:00Z' },
  ];
  assert.deepEqual(upcomingSavedEvents(events, ['past', 'later', 'next', 'deleted'], Date.parse('2026-09-22T10:00:00Z')).map(e => e.id), ['next', 'later']);
  assert.deepEqual(upcomingSavedEvents(events, [], Date.now()), []);
});

test('a saved live event stays in the collection until it ends', () => {
  const now = Date.parse('2026-09-29T23:00:00Z');
  const events = [
    { id: 'live', startsAt: '2026-09-29T20:00:00Z', endsAt: '2026-09-30T01:00:00Z' },
    { id: 'ended', startsAt: '2026-09-29T18:00:00Z', endsAt: '2026-09-29T22:00:00Z' },
  ];
  assert.deepEqual(upcomingSavedEvents(events, ['live', 'ended'], now).map((event) => event.id), ['live']);
});
