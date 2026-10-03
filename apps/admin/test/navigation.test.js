import test from 'node:test';
import assert from 'node:assert/strict';
import { changedQuery, directoryResources, listQuery, readRoute, recordQuery, returnQuery, recordReturnLabel } from '../src/lib/navigation.js';

test('opening and returning from a record preserves the entire report context', () => {
  const origin = '?section=analytics&period=90&regions=Orlando&regions=Miami&reportPage=3&reportSort=name_asc&drill=%5B%7B%22kind%22%3A%22businesses%22%2C%22id%22%3A%22business%22%2C%22label%22%3A%22Nightclub%22%7D%5D';
  const detail = recordQuery(origin, 'events', 'event-id');
  assert.deepEqual({ section: readRoute(detail).section, resource: readRoute(detail).resource, id: readRoute(detail).id }, { section: 'events', resource: 'events', id: 'event-id' });
  assert.equal(returnQuery(detail), origin);
  assert.equal(returnQuery(recordQuery(detail, 'users', 'person-id')), origin);
});
test('changing a multi-select replaces its values and retains unrelated context', () => {
  const query = changedQuery('?section=analytics&period=30&regions=A&regions=B&reportPage=3', { regions: ['C', 'D'], reportPage: 1 });
  assert.deepEqual(new URLSearchParams(query).getAll('regions'), ['C', 'D']);
  assert.equal(new URLSearchParams(query).get('period'), '30');
  assert.equal(new URLSearchParams(changedQuery(query, { regions: [] })).has('regions'), false);
});
test('venue records can return to their business tab without losing the original report', () => {
  const report = '?section=analytics&period=90&reportPage=3';
  const business = changedQuery(recordQuery(report, 'organizations', 'business-id'), { tab: 'venues', venuesPage: 2, venueSearch: 'Grand' });
  const venue = recordQuery(business, 'locations', 'venue-id', { preserveParent: true, tab: 'venue-team' });
  assert.equal(returnQuery(venue), business);
  assert.equal(recordReturnLabel(venue), 'Back to business');
  assert.equal(readRoute(venue).params.get('tab'), 'venue-team');
  assert.equal(recordQuery(venue, 'organizations', 'business-id'), business);
  assert.equal(returnQuery(business), report);
});
test('directory pagination and exact relation scopes are sent to the server', () => {
  const query = new URLSearchParams(listQuery(new URLSearchParams('page=2&search=Friday&sort=startsAt&direction=asc'), { organizationId: 'business-id' }));
  assert.equal(query.get('page'), '2'); assert.equal(query.get('pageSize'), '25'); assert.equal(query.get('organizationId'), 'business-id');
  assert.equal(query.get('search'), 'Friday'); assert.equal(query.get('sort'), 'startsAt');
});

test('Events date filters and timezone survive opening a record and returning', () => {
  const origin = '?section=events&resource=events&startDate=2027-03-14&endDate=2027-03-14&timezone=America%2FNew_York&page=2';
  const query = new URLSearchParams(listQuery(readRoute(origin).params));
  assert.equal(query.get('startDate'), '2027-03-14'); assert.equal(query.get('endDate'), '2027-03-14');
  assert.equal(query.get('timezone'), 'America/New_York');
  assert.equal(returnQuery(recordQuery(origin, 'events', 'event-id')), origin);
  assert.equal(new URLSearchParams(listQuery(new URLSearchParams('page=1'))).has('timezone'), false);
});
test('return navigation cannot redirect outside the application', () => {
  assert.equal(returnQuery('?section=events&returnTo=https%3A%2F%2Fexample.com'), '?section=events&resource=events');
  assert.equal(readRoute('?section=untrusted').section, 'overview');
  const messageRoute = readRoute('?section=messages&thread=private-conversation');
  assert.equal(messageRoute.section, 'messages');
  assert.equal(messageRoute.params.get('thread'), 'private-conversation');
  assert.equal(messageRoute.id, null);
});
test('consolidated directories retain purchases, invitations and history without generic owner writes', () => {
  const all = Object.values(directoryResources).flat();
  for (const key of ['organizations', 'locations', 'events', 'offerings', 'orders', 'users', 'onboarding_invitations', 'audit', 'email_outbox']) assert.ok(all.includes(key));
  assert.equal(all.includes('owners'), false);
});
test('primary directories describe people, businesses and events while canonical detail links remain valid', () => {
  for (const [section, primary] of [['people', 'users'], ['businesses', 'organizations'], ['events', 'events'], ['audit', 'audit']]) {
    assert.equal(readRoute(`?section=${section}&resource=orders`).resource, primary);
  }
  assert.equal(readRoute('?section=events&resource=tickets&record=ticket-id').resource, 'tickets');
});
test('multiple People statuses stay OR-filtered and preserve search and return context', () => {
  const params = new URLSearchParams('section=people&statuses=active&statuses=suspended&search=phone&page=3');
  const query = new URLSearchParams(listQuery(params));
  assert.deepEqual(query.getAll('statuses'), ['active', 'suspended']);
  assert.equal(query.get('search'), 'phone');
  assert.equal(returnQuery(recordQuery('?' + params, 'users', 'person-id')), '?' + params);
  assert.deepEqual(new URLSearchParams(changedQuery('?' + params, { statuses: [], status: null, page: 1 })).getAll('statuses'), []);
});
