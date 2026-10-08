import test from 'node:test';
import assert from 'node:assert/strict';
import { canApplyInitialEvent, parseCustomerRoute, rundownContextKeyFromSearch, rundownIdFromSearch, rundownPreviewFromSearch, updateCustomerRoute } from '../src/lib/customer-route.js';
import { mapsUrlForLocation } from '../src/lib/maps-link.js';
import { clearPassCache, loadPassCache, savePassCache } from '../src/lib/pass-cache.js';
import { discoveryShortcutRange } from '../src/lib/discovery-shortcuts.js';
import { uniqueSavedIds, savedIdBatches } from '../src/lib/saved-id-batch.js';

test('private rundown viewing is separate from public links and rejects invalid or operational routes', () => {
  const id = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  assert.deepEqual(rundownPreviewFromSearch('?rundownPreview=personal'), { kind: 'personal', organizationId: null });
  assert.deepEqual(rundownPreviewFromSearch(`?rundownPreview=${id.toUpperCase()}`), { kind: 'business', organizationId: id });
  assert.equal(rundownContextKeyFromSearch('?rundownPreview=personal'), 'preview:personal:');
  assert.equal(rundownContextKeyFromSearch(`?rundownPreview=${id}`), `preview:business:${id}`);
  assert.equal(rundownIdFromSearch(`?rundown=${id}&rundownPreview=personal`), id);
  assert.equal(rundownPreviewFromSearch(`?rundown=${id}&rundownPreview=personal`), null);
  for (const search of ['?rundownPreview=invalid', '?rundownPreview=personal&tab=my-events', `?rundownPreview=${id}&tab=saved`]) {
    assert.equal(rundownPreviewFromSearch(search), null);
    assert.equal(rundownContextKeyFromSearch(search), '');
  }
  const priorWindow = globalThis.window;
  const updates = [];
  globalThis.window = { location: { href: `https://nitewide.test/?rundownPreview=personal` }, history: { state: {}, pushState(_state, _title, url) { updates.push(url); } } };
  try {
    updateCustomerRoute({ eventId: id });
    updateCustomerRoute({ tab: 'my-events' });
    updateCustomerRoute({ tab: 'discover', rundownPreview: null });
  } finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; }
  assert.equal(updates[0].searchParams.get('rundownPreview'), 'personal', 'event detail retains the viewing context');
  assert.equal(updates[1].searchParams.has('rundownPreview'), false);
  assert.equal(updates[2].searchParams.has('rundownPreview'), false);
});

test('late initial event responses cannot replace a recovered checkout after its request lock clears', () => {
  const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  const response = { eventId, routeEventId: eventId, checkoutLocked: false };
  assert.equal(canApplyInitialEvent(response), true, 'an ordinary deep link opens event details');
  assert.equal(canApplyInitialEvent({ ...response, checkoutLocked: true }), false, 'recovery is still in flight');
  assert.equal(canApplyInitialEvent({ ...response, checkoutEventId: eventId }), false, 'restored checkout retains ownership after unlock');
  assert.equal(canApplyInitialEvent({ ...response, checkoutEventId: 'another-event' }), true, 'another event is not this checkout');
  assert.equal(canApplyInitialEvent({ ...response, routeEventId: null }), false, 'closing the event invalidates the response');
  assert.equal(canApplyInitialEvent({ ...response, routeEventId: 'another-event' }), false, 'navigation invalidates the response');
  assert.equal(canApplyInitialEvent({ ...response, eventId: null, routeEventId: null }), false);
});

test('customer routes restore tab, event, and submitted discovery filters', () => {
  assert.deepEqual(parseCustomerRoute('?tab=saved&event=61daf017-d30c-4030-9b89-dd29d875ddaf&city=Orlando&date=2026-09-29&q=house&when=tonight'), {
    tab: 'saved', eventId: '61daf017-d30c-4030-9b89-dd29d875ddaf', booking: null, city: 'Orlando', date: '2026-09-29', query: 'house', shortcut: '',
    scope: 'nearby', sort: 'recommended',
    myEventId: null, myStatus: 'upcoming', myPage: 1, mySearch: '',
  });
  assert.deepEqual(parseCustomerRoute('?city=Winter+Park%2C+FL&scope=city&sort=date'), {
    tab: 'discover', eventId: null, booking: null, city: 'Winter Park, FL', date: '', query: '', shortcut: '',
    scope: 'city', sort: 'date', myEventId: null, myStatus: 'upcoming', myPage: 1, mySearch: '',
  });
  assert.deepEqual(parseCustomerRoute('?tab=not-a-tab&when=tonight'), {
    tab: 'discover', eventId: null, booking: null, city: '', date: '', query: '', shortcut: '',
    scope: 'nearby', sort: 'recommended',
    myEventId: null, myStatus: 'upcoming', myPage: 1, mySearch: '',
  });
  const invalid = parseCustomerRoute(`?event=not-a-uuid&date=2026-02-30&city=${'c'.repeat(121)}&q=${'q'.repeat(121)}`);
  assert.equal(invalid.eventId, null);
  assert.equal(invalid.date, '', 'an impossible calendar date cannot trigger an invalid discovery request');
  assert.equal(invalid.city.length, 120);
  assert.equal(invalid.query.length, 120);
});

test('customer discovery route omits defaults, clears legacy shortcuts and restores explicit scope/sort', () => {
  const priorWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: { href: 'https://nitewide.test/?when=tonight' },
    history: { state: {}, pushState(_state, _title, url) { calls.push(url); } },
  };
  try {
    updateCustomerRoute({ city: 'Winter Park, FL', scope: 'nearby', sort: 'recommended', shortcut: '' });
    updateCustomerRoute({ city: 'Winter Park, FL', scope: 'city', sort: 'date' });
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  const defaults = new URL(calls[0]);
  assert.equal(defaults.searchParams.has('scope'), false);
  assert.equal(defaults.searchParams.has('sort'), false);
  assert.equal(defaults.searchParams.has('when'), false);
  const explicit = new URL(calls[1]);
  assert.equal(parseCustomerRoute(explicit.search).scope, 'city');
  assert.equal(parseCustomerRoute(explicit.search).sort, 'date');
});

test('route updates preserve unrelated referral and booking query params', () => {
  const priorWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: { href: 'https://nitewide.test/?ref=REF-123&booking=order-8&utm_source=friend' },
    history: {
      state: { existing: true },
      pushState(state, _title, url) { calls.push({ method: 'pushState', state, url }); },
      replaceState(state, _title, url) { calls.push({ method: 'replaceState', state, url }); },
    },
  };
  try {
    updateCustomerRoute({ tab: 'saved', eventId: '61daf017-d30c-4030-9b89-dd29d875ddaf', city: 'Orlando', query: 'jazz' }, { eventEntry: true });
    updateCustomerRoute({ eventId: null, tab: 'discover' }, { replace: true, eventEntry: false });
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  const pushed = new URL(calls[0].url);
  assert.equal(calls[0].method, 'pushState');
  assert.equal(calls[0].state.existing, true);
  assert.equal(calls[0].state.nitewideEventEntry, true);
  assert.equal(pushed.searchParams.get('ref'), 'REF-123');
  assert.equal(pushed.searchParams.get('booking'), 'order-8');
  assert.equal(pushed.searchParams.get('utm_source'), 'friend');
  assert.equal(pushed.searchParams.get('event'), '61daf017-d30c-4030-9b89-dd29d875ddaf');
  assert.equal(pushed.searchParams.get('tab'), 'saved');
  const replaced = new URL(calls[1].url);
  assert.equal(calls[1].method, 'replaceState');
  assert.equal(calls[1].state.nitewideEventEntry, false);
  assert.equal(replaced.searchParams.has('event'), false);
  assert.equal(replaced.searchParams.has('tab'), false);
  assert.equal(replaced.searchParams.get('booking'), 'order-8');
});

test('clearing an area remains explicit in the URL without rewriting the remembered preference', () => {
  const previousWindow = globalThis.window;
  let updated;
  globalThis.window = { location: { href: 'https://nitewide.test/?city=Miami%2C+FL&ref=REF-123' }, history: { state: {}, pushState(_state, _title, url) { updated = url; } } };
  try { updateCustomerRoute({ city: '' }); }
  finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
  assert.equal(new URL(updated).searchParams.has('city'), true);
  assert.equal(new URL(updated).searchParams.get('city'), '');
  assert.equal(new URL(updated).searchParams.get('ref'), 'REF-123');
});

test('discovery shortcuts use calendar dates through DST and month boundaries', () => {
  const sundayBeforeSpringForward = new Date(2026, 2, 8, 23, 30);
  assert.deepEqual(discoveryShortcutRange('tonight', sundayBeforeSpringForward), { start: '2026-03-08', end: '2026-03-08' });
  assert.deepEqual(discoveryShortcutRange('tomorrow', sundayBeforeSpringForward), { start: '2026-03-09', end: '2026-03-09' });
  assert.deepEqual(discoveryShortcutRange('weekend', new Date(2026, 9, 30, 12)), { start: '2026-10-30', end: '2026-11-01' });
  assert.deepEqual(discoveryShortcutRange('weekend', new Date(2026, 9, 31, 12)), { start: '2026-10-31', end: '2026-11-01' });
  assert.deepEqual(discoveryShortcutRange('weekend', new Date(2026, 10, 1, 12)), { start: '2026-10-31', end: '2026-11-01' });
  assert.equal(discoveryShortcutRange('later', new Date()), null);
});

test('Maps links require an address and never resolve for private venue locations', () => {
  const location = { addressLine1: '88 Nightlife Avenue', addressLine2: 'Suite 4', city: 'Orlando', region: 'FL', postalCode: '32801', countryCode: 'US', privacy: 'attendees_only', addressVisible: true };
  const url = mapsUrlForLocation(location);
  assert.equal(new URL(url).origin, 'https://maps.apple.com');
  assert.equal(new URL(url).searchParams.get('daddr'), '88 Nightlife Avenue, Suite 4, Orlando, FL, 32801, US');
  assert.equal(mapsUrlForLocation({ ...location, privacy: 'private' }), null);
  assert.equal(mapsUrlForLocation({ city: 'Orlando', privacy: 'public' }), null);
});

test('pass cache is account-scoped, expires after 24 hours or one hour after event end, and clears only that account', () => {
  const oldStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    get length() { return values.size; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
  };
  const now = Date.parse('2026-09-29T12:00:00Z');
  const longEvent = { id: 'long-purchase', event: { endsAt: '2026-10-05T12:00:00Z' }, tickets: [{ id: 'ticket-1', status: 'valid', qrImage: 'cached-qr' }] };
  const expiringEvent = { id: 'expiring-purchase', event: { endsAt: '2026-10-05T12:00:00Z' }, tickets: [{ id: 'ticket-2', status: 'valid', qrImage: 'cached-qr' }] };
  const endingSoon = { id: 'tonight', kind: 'guestlist', event: { endsAt: '2026-09-29T13:00:00Z' }, tickets: [{ id: 'guest-1', status: 'confirmed', qrImage: 'cached-guest-qr' }] };
  try {
    savePassCache('account-a', longEvent, now);
    savePassCache('account-a', endingSoon, now);
    savePassCache('account-b', { ...longEvent }, now);
    savePassCache('account-c', expiringEvent, now);
    assert.deepEqual(loadPassCache('account-a', 'purchase', 'long-purchase', now + 23 * 60 * 60 * 1000), longEvent);
    assert.equal(loadPassCache('account-c', 'purchase', 'expiring-purchase', now + 25 * 60 * 60 * 1000), null);
    assert.equal(loadPassCache('account-a', 'guestlist', 'tonight', now + 2 * 60 * 60 * 1000), null);
    assert.equal(loadPassCache('account-b', 'guestlist', 'tonight', now), null);
    clearPassCache('account-a');
    assert.equal(loadPassCache('account-a', 'purchase', 'long-purchase', now), null);
    assert.deepEqual(loadPassCache('account-b', 'purchase', 'long-purchase', now), longEvent);
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test('saved event helpers deduplicate identifiers and safely batch empty, large, and ordinary sets', () => {
  const firstId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  const secondId = '2a0200bf-9d74-46b0-8fa0-a24a6908a4b1';
  assert.deepEqual(uniqueSavedIds([firstId, '', null, firstId, 3, secondId, 'not-a-uuid']), [firstId, secondId]);
  assert.deepEqual(savedIdBatches([], 100), []);
  const ids = Array.from({ length: 205 }, (_, index) => `${String(index + 1).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const batches = savedIdBatches(ids, 100);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
  assert.deepEqual(batches.flat(), ids);
  assert.ok(batches.every((batch) => batch.length > 0 && batch.length <= 100));
  assert.deepEqual(savedIdBatches(ids.slice(0, 4), 50), [ids.slice(0, 4)]);
});
