import test from 'node:test';
import assert from 'node:assert/strict';
import { rundownIdFromSearch, updateCustomerRoute } from '../src/lib/customer-route.js';
import { loadRundownEvent } from '../src/lib/rundown-event.js';

const id = '61daf017-d30c-4030-9b89-dd29d875ddaf';
test('rundown routes accept opaque IDs only on the public discovery tab', () => {
  assert.equal(rundownIdFromSearch(`?rundown=${id.toUpperCase()}&event=${id}`), id);
  assert.equal(rundownIdFromSearch(`?tab=discover&rundown=${id}`), id);
  for (const search of ['?rundown=customer-name', `?tab=my-events&rundown=${id}`, `?tab=booked&rundown=${id}`]) assert.equal(rundownIdFromSearch(search), null);
});
test('event history retains the rundown and its personal credit; close removes event credit only', () => {
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = { location: { href: `https://nitewide.test/?rundown=${id}&utm_source=bio` }, history: { state: {}, pushState(state, title, url) { calls.push({ state, url }); }, replaceState(state, title, url) { calls.push({ state, url }); } } };
  try {
    updateCustomerRoute({ eventId: id, referralCode: `RUN-${id}` }, { eventEntry: true });
    assert.equal(calls[0].state.nitewideEventEntry, true);
    assert.equal(new URL(calls[0].url).searchParams.get('rundown'), id);
    assert.equal(new URL(calls[0].url).searchParams.get('ref'), `RUN-${id}`);
    globalThis.window.location.href = calls[0].url.toString();
    updateCustomerRoute({ eventId: null, referralCode: null }, { replace: true });
    const closed = new URL(calls[1].url);
    assert.equal(closed.searchParams.get('rundown'), id);
    assert.equal(closed.searchParams.has('event'), false);
    assert.equal(closed.searchParams.has('ref'), false);
    updateCustomerRoute({ tab: 'my-events' });
    assert.equal(new URL(calls[2].url).searchParams.has('rundown'), false);
    assert.equal(closed.searchParams.get('utm_source'), 'bio');
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
test('personal rundown opens fresh full event details with authoritative referral context', async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const result = await loadRundownEvent({ eventId: id, code: `RUN-${id}`, sessionKey: id, signal }, async (path, options) => {
    calls.push({ path, options });
    return path.endsWith('referral-visits') ? { code: `RUN-${id}`, referrerName: 'Host' } : { id, offerings: [{ id: 'complete-offering' }] };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.options.signal === signal), true);
  assert.deepEqual(calls[1].options.body, { code: `RUN-${id}`, sessionKey: id });
  assert.deepEqual(result.referral, { eventId: id, code: `RUN-${id}`, referrerName: 'Host' });
  assert.equal(result.event.offerings[0].id, 'complete-offering');
});
test('business rundown is uncredited and makes no referral visit', async () => {
  const calls = [];
  const result = await loadRundownEvent({ eventId: id, code: null }, async path => { calls.push(path); return { id }; });
  assert.deepEqual(calls, [`/events/${id}`]);
  assert.equal(result.referral, null);
});
test('failed, mismatched or revoked event credit cannot silently become a generic checkout', async () => {
  await assert.rejects(loadRundownEvent({ eventId: id, code: `RUN-${id}` }, async path => {
    if (path.endsWith('referral-visits')) throw new Error('Access revoked');
    return { id };
  }), /Access revoked/);
  await assert.rejects(loadRundownEvent({ eventId: id }, async () => ({ id: 'wrong' })), /no longer available/);
  await assert.rejects(loadRundownEvent({ eventId: id, code: 'RUN-code' }, async path => path.endsWith('referral-visits') ? { code: 'wrong' } : { id }), /no longer available/);
});
