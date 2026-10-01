import test from 'node:test';
import assert from 'node:assert/strict';
import { accessRequestDraft, onboardingPayload, requestFilters, requestListQuery, requestReviewPath, requestStatusCopy } from '../src/lib/business-access-requests.js';
import { hasAdminPermission } from '../src/lib/permissions.js';

test('request review defaults to pending and keeps directory filters independent', () => {
  const params = new URLSearchParams('search=directory&page=3&statuses=active');
  assert.deepEqual(requestFilters(params), { statuses: ['pending'], page: 1, search: '' });
  assert.equal(requestListQuery(params), 'page=1&pageSize=25&search=&statuses=pending');
  assert.equal(params.get('search'), 'directory'); assert.equal(params.get('page'), '3');
});
test('request filters support explicit all, multiselect and bounded server paging', () => {
  assert.deepEqual(requestFilters(new URLSearchParams('requestStatuses=all&requestPage=2&requestSearch=Morgan')), { statuses: [], page: 2, search: 'Morgan' });
  const query = new URLSearchParams(requestListQuery(new URLSearchParams('requestStatuses=pending&requestStatuses=declined&requestStatuses=pending&requestStatuses=unsafe&requestPage=-1')));
  assert.deepEqual(query.getAll('statuses'), ['pending', 'declined']); assert.equal(query.get('page'), '1'); assert.equal(query.get('pageSize'), '25');
  assert.equal(requestFilters(new URLSearchParams({ requestSearch: 'x'.repeat(150), requestPage: '100001' })).search.length, 120);
});
test('prefill edits no access, sets zero venues and does not infer manager finance', () => {
  const draft = accessRequestDraft({ displayName: 'Morgan', email: 'morgan@example.test', phone: '+14075550199', role: 'manager', businessName: 'New Business', details: 'Organizer requesting a workspace.' });
  assert.equal(draft.recipient.role, 'manager'); assert.equal(draft.recipient.financeAuthorized, false);
  assert.equal(draft.organization.description, 'Organizer requesting a workspace.'); assert.equal(draft.organization.name, 'New Business');
  const payload = onboardingPayload({ ...draft, venues: [], authority: false, reason: 'Review draft', accessRequest: { email: draft.recipient.email }, version: 3 });
  assert.equal(payload.confirmedAuthority, false); assert.deepEqual(payload.venues, []); assert.equal(payload.version, 3);
});
test('approval payload locks submitted email and clears irrelevant owner finance', () => {
  const payload = onboardingPayload({ recipient: { displayName: 'Corrected', email: 'tampered@example.test', phone: '+14075550199', role: 'owner', financeAuthorized: true }, organization: { name: 'Corrected Business', planTier: 'free', website: '' }, venues: [{ key: 'draft-only', name: 'Venue' }], authority: true, reason: 'Verified authority', accessRequest: { email: 'submitted@example.test' }, version: 7 });
  assert.equal(payload.recipient.email, 'submitted@example.test'); assert.equal(payload.recipient.financeAuthorized, false); assert.equal(payload.version, 7);
  assert.deepEqual(payload.venues, [{ name: 'Venue' }]); assert.equal(payload.organization.website, undefined);
  assert.equal(JSON.stringify(payload).includes('password'), false);
});
test('manual onboarding stays compatible and review navigation safely encodes identifiers', () => {
  const payload = onboardingPayload({ ...accessRequestDraft(), venues: [], authority: true, reason: 'Manual review' });
  assert.equal('version' in payload, false); assert.equal(payload.kind, 'organization');
  assert.equal(requestReviewPath('id&record=bad'), '?section=businesses&businessView=requests&request=id%26record%3Dbad');
});
test('approved copy distinguishes secure acceptance from active access and declined grants nothing', () => {
  assert.match(requestStatusCopy('approved'), /requires the recipient to accept/); assert.match(requestStatusCopy('pending'), /not granted/); assert.match(requestStatusCopy('declined'), /not granted/);
});
test('access review mutations stay platform-owner-only while staff can read the queue', () => {
  const actor = { isInternalAdmin: true, isActive: true, lifecycleState: 'active' };
  for (const role of ['support', 'operations', 'read_only']) {
    assert.equal(hasAdminPermission({ ...actor, internalAdminRole: role }, 'directory.view'), true);
    assert.equal(hasAdminPermission({ ...actor, internalAdminRole: role }, 'access.manage'), false);
  }
  assert.equal(hasAdminPermission({ ...actor, internalAdminRole: 'platform_owner' }, 'access.manage'), true);
  assert.equal(hasAdminPermission({ ...actor, internalAdminRole: 'unknown' }, 'directory.view'), false);
  assert.equal(hasAdminPermission({ ...actor, isActive: false, internalAdminRole: 'platform_owner' }, 'access.manage'), false);
});
