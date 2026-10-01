import test from 'node:test';
import assert from 'node:assert/strict';
import { eventActivityGroups, groupedActivity, personActivity, relatedRecords } from '../src/lib/record-relations.js';

test('People groups human activity and keeps legacy direct tabs inside the same context', () => {
  const activity = personActivity('people-invitations', 'guestlist_invitations', relatedRecords.users);
  assert.equal(activity.selected[0], 'guestlist_invitations');
  assert.equal(activity.members.length, 3);
  assert.equal(personActivity('venue_access', null, relatedRecords.users).key, 'people-roles');
  assert.equal(personActivity('basics', null, relatedRecords.users), null);
});
test('Events groups invitations and attendance without losing its exact relation scopes', () => {
  assert.equal(groupedActivity(eventActivityGroups, 'guestlist_invitations', null, relatedRecords.events).key, 'event-guestlist');
  assert.equal(groupedActivity(eventActivityGroups, 'event-admissions', 'check_ins', relatedRecords.events).selected[0], 'check_ins');
  for (const [, , scope] of relatedRecords.orders) assert.ok(scope.orderId || scope.entityId);
});
