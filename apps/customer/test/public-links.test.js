import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTarget, publicRouteParams, eventPublicLink } from '../../shared/public-links.mjs';
import { parseCustomerRoute, rundownIdFromSearch, updateCustomerRoute } from '../src/lib/customer-route.js';
import { referralFromSearch } from '../src/lib/referral.js';
const eventId = 'a1000000-0000-4000-8000-000000000001', rundownId = 'a1000000-0000-4000-8000-000000000002';
test('permanent public links have one identity and preserve event-specific referral credit and old URLs', () => {
  assert.equal(eventPublicLink(eventId, 'https://nitewide.test', 'STAFF + & code'), `https://nitewide.test/events/${eventId}?ref=STAFF+%2B+%26+code`);
  assert.deepEqual(publicTarget(`/rundowns/${rundownId}`), { kind: 'rundowns', id: rundownId });
  assert.equal(publicTarget('/events/not-a-uuid'), null); assert.equal(publicTarget(`/events/${eventId}/extra`), null);
  assert.equal(publicRouteParams(`?event=${rundownId}`, `/events/${eventId}`).get('event'), eventId);
  const original = globalThis.window, updates = [];
  globalThis.window = { location: new URL(`https://nitewide.test/rundowns/${rundownId}?utm_source=bio`), history: { state: {},
    pushState(_state, _title, next) { this.state = _state; globalThis.window.location = new URL(next); updates.push(new URL(next)); } } };
  try {
    assert.equal(rundownIdFromSearch(window.location.search), rundownId);
    updateCustomerRoute({ eventId, referralCode: `RUN-${rundownId}` }, { eventEntry: true });
    assert.equal(window.location.pathname, `/events/${eventId}`); assert.equal(parseCustomerRoute(window.location.search).eventId, eventId);
    assert.deepEqual(referralFromSearch(window.location.search), { eventId, code: `RUN-${rundownId}` });
    assert.equal(rundownIdFromSearch(window.location.search), rundownId);
    updateCustomerRoute({ eventId: null, referralCode: null }); assert.equal(window.location.pathname, `/rundowns/${rundownId}`);
    assert.equal(window.location.search, '?utm_source=bio');
    updateCustomerRoute({ tab: 'my-events' }); assert.equal(window.location.pathname, '/'); assert.equal(rundownIdFromSearch(window.location.search), null);
    window.location = new URL(`https://nitewide.test/?event=${eventId}&ref=legacy`);
    assert.deepEqual(referralFromSearch(window.location.search), { eventId, code: 'legacy' });
  } finally { globalThis.window = original; }
});
