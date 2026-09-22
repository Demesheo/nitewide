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
