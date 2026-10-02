import test from 'node:test';
import assert from 'node:assert/strict';
import { myEventAccessLost, myEventActionsReadOnly, myEventGuestActions, myEventGuestPageQuery, myEventInviteBody, myEventInvitePools, myEventInvitationUrl } from '../src/lib/my-event-actions.js';

test('guestlist writes and sharing fail closed, including events that end while open', () => {
  assert.equal(myEventActionsReadOnly({}), true);
  assert.equal(myEventActionsReadOnly({ capabilities: { readOnly: true } }), true);
  const detail = { event: { status: 'published', endsAt: '2099-01-01T00:00:00Z' }, capabilities: { readOnly: false } };
  assert.equal(myEventActionsReadOnly(detail, Date.parse('2098-12-31T23:59:59Z')), false);
  assert.equal(myEventActionsReadOnly(detail, Date.parse('2099-01-01T00:00:00Z')), true);
  assert.equal(myEventActionsReadOnly({ ...detail, event: { ...detail.event, status: 'completed' } }, 0), true);
});

test('review applies to pending and revocation only applies to approvals with zero admitted passes', () => {
  const permissions = { readOnly: false, canReviewGuestlist: true };
  assert.equal(myEventGuestActions({ status: 'pending' }, permissions).review, true);
  assert.equal(myEventGuestActions({ status: 'rejected' }, permissions).review, false);
  assert.equal(myEventGuestActions({ status: 'confirmed', checkedInSpots: 0, checkedInAt: null }, permissions).revoke, true);
  for (const entry of [
    { status: 'confirmed', checkedInSpots: 1 },
    { status: 'confirmed', checkedInAt: '2098-12-31T23:00:00Z' },
    { status: 'checked_in', checkedInSpots: 0 },
  ]) assert.equal(myEventGuestActions(entry, permissions).revoke, false);
  assert.deepEqual(myEventGuestActions({ status: 'pending', hasInvitation: true }), { review: false, revoke: false, copy: false, admitted: false });
  assert.equal(myEventGuestActions({ status: 'confirmed', hasInvitation: true }, { readOnly: true, canReviewGuestlist: true }).copy, false);
});

test('invitation bodies require guest name, integer 1–20 spots and only the selected contact', () => {
  const fields = { name: ' Alex Guest ', pool: 'direct', partySize: '4', inviteBy: 'personal', email: 'old@example.test', phone: '+14075551212' };
  assert.deepEqual(myEventInviteBody(fields), { pool: 'direct', name: 'Alex Guest', partySize: 4, inviteBy: 'personal' });
  assert.deepEqual(myEventInviteBody({ ...fields, pool: 'own-pool', inviteBy: 'email' }), { pool: 'own', eventAffiliateId: 'own-pool', name: 'Alex Guest', partySize: 4, inviteBy: 'email', email: 'old@example.test' });
  assert.deepEqual(myEventInviteBody({ ...fields, inviteBy: 'phone' }), { pool: 'direct', name: 'Alex Guest', partySize: 4, inviteBy: 'phone', phone: '+14075551212' });
  for (const partySize of ['0', '21', '1.5', 'bad', '']) assert.throws(() => myEventInviteBody({ ...fields, partySize }), /1 and 20/);
  assert.throws(() => myEventInviteBody({ ...fields, name: ' ' }), /guest name/);
  assert.throws(() => myEventInviteBody({ ...fields, inviteBy: 'email', email: 'broken' }), /email address/);
  assert.throws(() => myEventInviteBody({ ...fields, inviteBy: 'phone', phone: '' }), /phone number/);
});

test('private links start at customer origin root and cannot retain checkout or operator parameters', () => {
  const link = new URL(myEventInvitationUrl('fixture-secret', 'https://customer.test/my-events?event=other&ref=other&checkout=old#details'));
  assert.equal(link.pathname, '/');
  assert.equal(link.hash, '');
  assert.deepEqual([...link.searchParams], [['guestlistInvite', 'fixture-secret']]);
  assert.throws(() => myEventInvitationUrl(null, 'https://customer.test'), /unavailable/);
});

test('server pagination is bounded and multiple statuses use the supported repeated query', () => {
  const query = new URLSearchParams(myEventGuestPageQuery({ page: 3, search: ' Alex ', statuses: ['confirmed', 'pending', 'unknown'] }));
  assert.equal(query.get('page'), '3'); assert.equal(query.get('pageSize'), '10'); assert.equal(query.get('search'), 'Alex');
  assert.deepEqual(query.getAll('statuses'), ['pending', 'confirmed']);
  assert.deepEqual(new URLSearchParams(myEventGuestPageQuery()).getAll('statuses'), []);
});

test('only authorized pools are offered, and entry-not-found remains a local error', () => {
  assert.deepEqual(myEventInvitePools({ direct: false, own: [{ id: 'mine', guestlistAllocation: 4 }], open: true }), [{ id: 'mine', label: 'My allocation · 4 spots' }]);
  assert.equal(myEventAccessLost({ status: 404 }), false);
  assert.equal(myEventAccessLost({ status: 404 }, true), true);
  assert.equal(myEventAccessLost({ status: 403 }), true);
  assert.equal(myEventAccessLost({ status: 401 }), true);
});
