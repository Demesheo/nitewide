import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomerRoute, updateCustomerRoute } from '../src/lib/customer-route.js';
import { myEventBusinessUrl, myEventPhase, myEventsListPath, myEventsMoney } from '../src/lib/my-events.js';

const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';

test('operator deep links never open public checkout and ignore operator state outside My events', () => {
  const route = parseCustomerRoute(`?tab=my-events&myEvent=${eventId}&myStatus=past&myPage=7&mySearch=%20house%20&event=${eventId}&booking=purchase:${eventId}&city=Orlando&q=discover&date=2026-10-02&when=tonight`);
  assert.equal(route.myEventId, eventId);
  assert.equal(route.eventId, null);
  assert.equal(route.booking, null);
  assert.equal(route.myStatus, 'past');
  assert.equal(route.myPage, 7);
  assert.equal(route.mySearch, 'house');
  assert.deepEqual([route.city, route.date, route.query, route.shortcut], ['', '', '', '']);
  for (const tab of ['discover', 'saved', 'booked', 'connections']) {
    const ordinary = parseCustomerRoute(`?tab=${tab}&myEvent=${eventId}&myStatus=past&myPage=7&mySearch=house`);
    assert.equal(ordinary.myEventId, null);
    assert.equal(ordinary.myPage, 1);
    assert.equal(ordinary.mySearch, '');
  }
  assert.equal(parseCustomerRoute('?tab=my-events&myEvent=../../admin&myPage=Infinity&myStatus=unknown').myEventId, null);
  assert.equal(parseCustomerRoute('?tab=my-events&myPage=1.5').myPage, 1);
  assert.equal(parseCustomerRoute('?tab=my-events&myPage=100001').myPage, 100000);
});

test('My events URL fields are removed on leaving, while unrelated campaign state survives', () => {
  const prior = globalThis.window;
  let href = `https://nitewide.test/?event=${eventId}&ref=MY-REF&city=Orlando&q=house&utm_source=friend`;
  const calls = [];
  globalThis.window = { location: { get href() { return href; } }, history: { state: {}, pushState(state, _title, url) { href = String(url); calls.push(state); }, replaceState(state, _title, url) { href = String(url); calls.push(state); } } };
  try {
    updateCustomerRoute({ tab: 'my-events', myEventId: eventId, myStatus: 'past', myPage: 2, mySearch: 'Lounge' });
    const operator = new URL(href);
    assert.equal(operator.searchParams.get('myEvent'), eventId);
    for (const field of ['event', 'ref', 'city', 'q', 'booking']) assert.equal(operator.searchParams.has(field), false);
    assert.equal(operator.searchParams.get('utm_source'), 'friend');
    updateCustomerRoute({ city: 'Atlanta' }, { replace: true });
    assert.equal(new URL(href).searchParams.has('city'), false, 'background location detection cannot pollute the operator view');
    updateCustomerRoute({ tab: 'booked', booking: `purchase:${eventId}` });
    const customer = new URL(href);
    for (const field of ['myEvent', 'myStatus', 'myPage', 'mySearch']) assert.equal(customer.searchParams.has(field), false);
    assert.equal(customer.searchParams.get('booking'), `purchase:${eventId}`);
    assert.equal(customer.searchParams.get('utm_source'), 'friend');
    assert.equal(calls[0].nitewideEventEntry, false);
  } finally { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; }
});

test('event timing includes ongoing nights and list requests preserve server pagination and explicit search', () => {
  const now = Date.parse('2026-10-02T20:00:00Z');
  assert.equal(myEventPhase({ status: 'published', startsAt: '2026-10-02T19:00:00Z', endsAt: '2026-10-03T03:00:00Z' }, now), 'ongoing');
  assert.equal(myEventPhase({ status: 'published', startsAt: '2026-10-02T19:00:00Z', endsAt: '2026-10-02T20:00:00Z' }, now), 'past');
  assert.equal(myEventPhase({ status: 'cancelled', startsAt: '2026-10-04T19:00:00Z' }, now), 'cancelled');
  const params = new URL(myEventsListPath({ myStatus: 'past', myPage: 4, mySearch: ' Lounge & house ' }), 'https://nitewide.test').searchParams;
  assert.equal(params.get('status'), 'past'); assert.equal(params.get('sort'), 'starts_desc'); assert.equal(params.get('page'), '4'); assert.equal(params.get('pageSize'), '12'); assert.equal(params.get('search'), 'Lounge & house');
  assert.equal(new URL(myEventsListPath({}), 'https://nitewide.test').searchParams.get('sort'), 'starts_asc');
  assert.equal(myEventsMoney(null), 'Unavailable'); assert.equal(myEventsMoney(undefined), 'Unavailable'); assert.equal(myEventsMoney(0), '$0.00');
});

test('Open in Business targets the workspace event deep link instead of the business landing page', () => {
  const link = new URL(myEventBusinessUrl('https://business.nitewide.test/', eventId, { href: 'https://nitewide.test/' }));
  assert.equal(link.origin, 'https://business.nitewide.test');
  assert.equal(link.pathname, '/app');
  assert.equal(link.searchParams.get('section'), 'events');
  assert.equal(link.searchParams.get('event'), eventId);
});
