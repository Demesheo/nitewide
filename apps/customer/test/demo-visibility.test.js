import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPresentation, isHiddenDemoPerson } from '../src/lib/demo-visibility.js';
const owner = { id: '10000000-0000-4000-8000-000000000002', name: 'Maya Portfolio Owner' };
const promoter = { id: 'promoter', name: 'Maya Flores' };
test('clear-all notification responses pass through without list transformation', () => {
  const response = { dismissed: 55 };
  assert.equal(customerPresentation('/notifications', response), response);
});
test('only the development owner is hidden, never unrelated Mayas or real owners', () => {
  assert.equal(isHiddenDemoPerson(owner), true);
  assert.equal(isHiddenDemoPerson({ id: owner.id, name: 'Renamed debugging owner' }), true);
  assert.equal(isHiddenDemoPerson({ name: 'Maya Portfolio Owner' }), true);
  assert.equal(isHiddenDemoPerson(promoter), false);
  assert.equal(isHiddenDemoPerson({ name: 'Maya', role: 'owner' }), false);
});
test('both connection feeds and header counts exclude the debug owner without mutating API records', () => {
  const feed = [{ referrer: owner, event: { id: 'event' }, code: 'OWNER' }, { referrer: promoter, event: { id: 'event' }, code: 'PROMOTER' }];
  assert.deepEqual(customerPresentation('/customer/connections', feed), [feed[1]]);
  assert.equal(feed.length, 2);
  const summary = { eligible: true, people: [owner, promoter] };
  assert.deepEqual(customerPresentation('/customer/connections/summary', summary), { eligible: true, people: [promoter] });
  assert.deepEqual(summary.people, [owner, promoter]);
  assert.equal(customerPresentation('/customer/connections/summary', { eligible: true, people: [owner] }).eligible, false);
});
test('owner link attribution and actionable notification records remain intact while masking the name', () => {
  const visit = { eventId: 'event', code: 'OWNER', referrerName: owner.name };
  assert.deepEqual(customerPresentation('/events/event/referral-visits', visit), { ...visit, referrerName: 'Your host' });
  assert.equal(visit.referrerName, owner.name);
  const notifications = { unreadCount: 1, items: [{ id: 'notice', eventId: 'event', title: 'Maya Portfolio Owner invited you', message: 'Approved by Maya Portfolio Owner', readAt: null }] };
  const displayed = customerPresentation('/notifications', notifications);
  assert.equal(displayed.unreadCount, 1); assert.equal(displayed.items[0].id, 'notice');
  assert.doesNotMatch(JSON.stringify(displayed), /Maya Portfolio Owner/);
  assert.match(notifications.items[0].title, /Maya Portfolio Owner/);
  assert.equal(customerPresentation('/customer/bookings', visit), visit);
});
