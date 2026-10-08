import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRundownEvents, prepareRundownPage, rundownIdKey, rundownPagePath, rundownPreviewPath, rundownProfileName } from '../src/lib/rundown.js';

const id = 'a1000000-0000-4000-8000-000000000001';
const event = key => ({ id: key, title: `Night ${key}`, offerings: [], referralCode: null });
const page = (items = [], extra = {}) => ({ profile: { kind: 'personal', name: 'Alex Morgan' }, items, hasMore: false, nextCursor: null, ...extra });

test('rundown paths use only the opaque ID, six-item size and encoded cursor', () => {
  assert.equal(rundownIdKey(id.toUpperCase()), id);
  assert.equal(rundownPagePath(id), `/rundowns/${id}?pageSize=6`);
  const path = rundownPagePath(id, 'next/+&city=Miami');
  const params = new URL(path, 'https://fixture.test').searchParams;
  assert.equal(params.get('cursor'), 'next/+&city=Miami');
  assert.deepEqual([...params.keys()], ['pageSize', 'cursor']);
  for (const invalid of [null, undefined, '', '../events', 'Alex-Morgan', `${id}/events`]) {
    assert.equal(rundownIdKey(invalid), '');
    assert.equal(rundownPagePath(invalid), null);
  }
});

test('private preview paths validate kind and organization without an ID or publication request', () => {
  assert.equal(rundownPreviewPath({ kind: 'personal', organizationId: null }), '/customer/rundowns/preview?kind=personal&pageSize=6');
  const business = new URL(rundownPreviewPath({ kind: 'business', organizationId: id.toUpperCase() }, 'next/+&city=Miami'), 'https://fixture.test');
  assert.equal(business.pathname, '/customer/rundowns/preview');
  assert.deepEqual([...business.searchParams.entries()], [['kind', 'business'], ['pageSize', '6'], ['organizationId', id], ['cursor', 'next/+&city=Miami']]);
  for (const invalid of [null, {}, { kind: 'other' }, { kind: 'business' }, { kind: 'business', organizationId: '../events' }, { kind: 'personal', organizationId: id }]) {
    assert.equal(rundownPreviewPath(invalid), null);
  }
});

test('rundown pages accept personal and business display names as bounded plain text', () => {
  const markup = '<img src=x onerror="window.bad=true">';
  assert.equal(rundownProfileName({ name: ` \u0000${markup}\n ` }), markup);
  assert.equal(rundownProfileName({ name: 'x'.repeat(300) }).length, 200);
  assert.equal(rundownProfileName({ name: {} }), '');
  for (const kind of ['personal', 'business']) {
    const input = page([event('one')], { profile: { kind, name: ` ${markup} ` } });
    const prepared = prepareRundownPage(input);
    assert.deepEqual(prepared.profile, { kind, name: markup });
    assert.equal(input.profile.name, ` ${markup} `);
  }
});

test('rundown pages deduplicate event IDs and preserve event-specific nullable attribution', () => {
  const first = event('one');
  const referred = { ...event('two'), referralCode: 'second-event-code' };
  const input = page([first, first, referred, { ...event('three'), offerings: null, referralCode: {} }]);
  const prepared = prepareRundownPage(input);
  assert.deepEqual(prepared.items.map(item => item.id), ['one', 'two', 'three']);
  assert.equal(prepared.items[1].referralCode, 'second-event-code');
  assert.equal(prepared.items[2].referralCode, null);
  assert.deepEqual(prepared.items[2].offerings, []);
  assert.equal(input.items.length, 4);
  assert.deepEqual(appendRundownEvents(prepared.items, [event('two'), event('four'), event('four')]).map(item => item.id), ['one', 'two', 'three', 'four']);
});

test('malformed and oversized rundown pages fail without implying an empty successful result', () => {
  for (const invalid of [null, {}, page([], { profile: { kind: 'personal', name: '' } }),
    page([], { profile: { kind: 'other', name: 'Alex' } }), page(null),
    page([], { hasMore: 'yes' }), page([], { hasMore: true, nextCursor: null }),
    page([{}]), page([event('')]), page(Array.from({ length: 7 }, (_, index) => event(String(index))))]) {
    assert.throws(() => prepareRundownPage(invalid));
  }
  assert.equal(prepareRundownPage(page([], { nextCursor: 'unused' })).nextCursor, null);
});
