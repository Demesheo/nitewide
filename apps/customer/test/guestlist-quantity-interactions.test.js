import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('customer guestlist steppers preserve drafts, cap requests and submit the chosen approval', async (t) => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `https://customer.test/?event=${eventId}&city=Orlando`, pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : typeof dom.window[key] === 'function' && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const oldFetch = globalThis.fetch, calls = [];
  const session = { accessToken: 'fixture-token', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), user: { id: 'fixture-customer', displayName: 'Fixture Customer', email: 'fixture@example.test' } };
  const event = { id: eventId, title: 'Fixture Night', status: 'published', startsAt: '2099-10-02T23:00:00Z', endsAt: '2099-10-03T03:00:00Z', offerings: [], category: 'nightlife', location: { name: 'Fixture Lounge', city: 'Orlando', region: 'FL', timezone: 'America/New_York' } };
  const pending = { id: 'pending-fixture', guestName: 'Pending Guest', partySize: 2, status: 'pending', checkedInSpots: 0, source: 'direct', createdAt: '2099-10-01T20:00:00Z' };
  const capabilities = { readOnly: false, canReviewGuestlist: true };
  const detail = { event, scope: 'event', capabilities };
  const response = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status, headers: { 'content-type': 'application/json' } });
  let handler, vite, view, React, render, screen, waitFor, act, user, App, AccountDialog, MyEventGuestDetail;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    const call = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    return handler(call);
  };
  function reset() {
    view?.unmount(); view = null;
    dom.window.document.body.innerHTML = '<div id="root"></div>';
    dom.window.localStorage.clear();
    dom.window.history.replaceState({}, '', `/?event=${eventId}&city=Orlando`);
    calls.length = 0;
  }
  const container = () => dom.window.document.getElementById('root');
  function appHandler(call, entry = null, maxPartySize = 5) {
    const path = call.url.pathname;
    if (call.url.hostname === 'api.bigdatacloud.net') return new Response(JSON.stringify({ city: 'Orlando', principalSubdivisionCode: 'US-FL' }));
    if (path === '/api/events') return response({ items: [], nextCursor: null });
    if (path === `/api/events/${eventId}`) return response(event);
    if (path.endsWith(`/events/${eventId}/guestlist`)) return response({ entry, maxPartySize, requestsOpen: true });
    if (path.endsWith('/auth/me')) return response({ user: session.user });
    if (path.endsWith('/customer/my-events/access')) return response({ eligible: false });
    if (path.endsWith('/customer/payment-config')) return response({ enabled: false });
    if (path.endsWith('/customer/connections/summary')) return response({ eligible: false, people: [] });
    if (path.endsWith('/customer/saved/ids')) return response({ savedIds: [] });
    if (path.endsWith('/customer/connections') || path.endsWith('/notifications')) return response({ items: [], hasMore: false, unreadCount: 0 });
    throw new Error(`Unhandled fixture path: ${path}`);
  }
  async function mountApp(entry = null, maxPartySize = 5, signedIn = true, mutation) {
    reset();
    if (signedIn) dom.window.localStorage.setItem('nitewide.session', JSON.stringify(session));
    handler = (call) => call.body && mutation ? mutation(call) : appHandler(call, entry, maxPartySize);
    view = render(React.createElement(App), { container: container() });
    await user.click(await screen.findByRole('tab', { name: 'Guestlist' }));
    await waitFor(() => assert.equal(screen.getByRole('spinbutton', { name: 'Party size, including you' }).disabled, false));
  }
  const quantity = (name) => Number(screen.getByRole('spinbutton', { name }).getAttribute('aria-valuenow'));
  async function adjust(name, count) { for (let index = 0; index < count; index += 1) await user.click(screen.getByRole('button', { name })); }
  const reviewProps = (selected = pending, overrides = {}) => ({ session, detail, capabilities, selected, returnRef: { current: null }, onClose() {}, onChanged: async () => {}, onFailure() {}, ...overrides });
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', ssr: { external: ['@nitewide/pricing'] } });
    ({ default: App } = await vite.ssrLoadModule('/src/App.jsx'));
    ({ AccountDialog } = await vite.ssrLoadModule('/src/components/account-dialog.jsx'));
    ({ MyEventGuestDetail } = await vite.ssrLoadModule('/src/components/my-event-guest-detail.jsx'));
    React = await import('react');
    ({ render, screen, waitFor, act } = await import('@testing-library/react'));
    user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });

    await t.test('signed-out request control uses five and cannot be typed or stepped beyond its bounds', async () => {
      await mountApp(null, 20, false);
      const field = screen.getByRole('spinbutton', { name: 'Party size, including you' });
      assert.equal(field.readOnly, true);
      assert.equal(field.getAttribute('aria-readonly'), 'true');
      assert.equal(field.getAttribute('aria-valuemax'), '5');
      assert.equal(screen.getByRole('button', { name: 'Decrease guestlist spots' }).disabled, true);
      await user.type(field, '20');
      assert.equal(quantity('Party size, including you'), 1);
      await adjust('Increase guestlist spots', 4);
      assert.equal(quantity('Party size, including you'), 5);
      assert.equal(screen.getByRole('button', { name: 'Increase guestlist spots' }).disabled, true);
      assert.ok(screen.getByText(/Choose 1–5 guests/));
      reset();
    });

    await t.test('signed-in request clamps old server limits, freezes while submitting and retains the draft after failure', async () => {
      let release;
      await mountApp(null, 20, true, () => new Promise((resolve) => { release = () => resolve(response({ message: 'Guestlist is unavailable. Try again later.' }, 503)); }));
      await adjust('Increase guestlist spots', 4);
      await user.click(screen.getByRole('button', { name: 'Request guestlist approval' }));
      await waitFor(() => assert.equal(typeof release, 'function'));
      assert.deepEqual(calls.find((call) => call.body).body, { partySize: 5 });
      assert.equal(screen.getByRole('button', { name: 'Decrease guestlist spots' }).disabled, true);
      const form = screen.getByRole('spinbutton', { name: 'Party size, including you' }).closest('form');
      await act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      assert.equal(calls.filter((call) => call.body).length, 1);
      await act(async () => release());
      await screen.findByText('Guestlist is unavailable. Try again later.');
      assert.equal(quantity('Party size, including you'), 5);
      assert.equal(screen.getByRole('button', { name: 'Decrease guestlist spots' }).disabled, false);
      reset();
    });

    await t.test('a smaller server allowance disables increase at its reported limit', async () => {
      await mountApp(null, 3);
      await adjust('Increase guestlist spots', 2);
      assert.equal(quantity('Party size, including you'), 3);
      assert.equal(screen.getByRole('spinbutton', { name: 'Party size, including you' }).getAttribute('aria-valuemax'), '3');
      assert.equal(screen.getByRole('button', { name: 'Increase guestlist spots' }).disabled, true);
      reset();
    });

    await t.test('legacy pending requests retain their actual quantity and must reduce to five before saving', async () => {
      const legacy = { ...pending, partySize: 7 };
      await mountApp(legacy, 20, true, (call) => response({ entry: { ...legacy, partySize: call.body.partySize } }));
      assert.equal(quantity('Party size, including you'), 7);
      assert.ok(screen.getByText('7 guests · Pending'));
      assert.equal(screen.getByRole('button', { name: 'Increase guestlist spots' }).disabled, true);
      assert.equal(screen.getByRole('button', { name: 'Update party size' }).disabled, true);
      const form = screen.getByRole('spinbutton', { name: 'Party size, including you' }).closest('form');
      await act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      assert.equal(calls.filter((call) => call.body).length, 0);
      await adjust('Decrease guestlist spots', 1);
      assert.equal(quantity('Party size, including you'), 6);
      assert.equal(screen.getByRole('button', { name: 'Update party size' }).disabled, true);
      await adjust('Decrease guestlist spots', 1);
      await user.click(screen.getByRole('button', { name: 'Update party size' }));
      await waitFor(() => assert.ok(screen.getByText('5 guests · Pending')));
      assert.deepEqual(calls.find((call) => call.body).body, { partySize: 5 });
      reset();
    });

    await t.test('Booked edits initialize deep-linked legacy requests, cap at five and keep a failed draft retryable', async () => {
      reset();
      let release;
      const ticket = { id: pending.id, kind: 'guestlist', partySize: 7, event, tickets: [{ id: 'pending-pass', status: 'pending', qrImage: null, offering: 'Guestlist' }] };
      handler = (call) => call.method === 'PATCH' ? new Promise((resolve) => { release = () => resolve(response({ message: 'Try again later.' }, 503)); }) : response({ orders: [], guestlists: [], entries: [], total: 0 });
      view = render(React.createElement(AccountDialog, { open: true, embedded: true, session, bookingRoute: `guestlist:${pending.id}`, notificationBooking: { ticket }, onOpenChange() {} }), { container: container() });
      await user.click(await screen.findByRole('button', { name: 'Edit spots' }));
      assert.equal(quantity('Spots'), 7);
      assert.equal(screen.getByRole('button', { name: 'Save spots' }).disabled, true);
      assert.equal(screen.getByRole('button', { name: 'Increase guestlist spots' }).disabled, true);
      await adjust('Decrease guestlist spots', 2);
      await user.click(screen.getByRole('button', { name: 'Save spots' }));
      await waitFor(() => assert.equal(typeof release, 'function'));
      assert.equal(screen.getByRole('button', { name: 'Decrease guestlist spots' }).disabled, true);
      assert.equal(screen.getByRole('button', { name: 'Cancel', exact: true }).disabled, true);
      const form = screen.getByRole('spinbutton', { name: 'Spots' }).closest('form');
      await act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
      assert.deepEqual(calls.find((call) => call.method === 'PATCH').body, { partySize: 5 });
      await act(async () => release());
      await screen.findByRole('alert');
      assert.equal(quantity('Spots'), 5);
      assert.equal(screen.getByRole('button', { name: 'Save spots' }).disabled, false);
      reset();
    });

    await t.test('reviewers approve the draft from one to twenty, block changes while busy and preserve failures', async () => {
      reset();
      let release, closes = 0;
      const changes = [];
      handler = (call) => call.method === 'POST' ? new Promise((resolve) => { release = () => resolve(response({ message: 'Not enough space.' }, 409)); }) : response(pending);
      view = render(React.createElement(MyEventGuestDetail, reviewProps(pending, { onClose: () => { closes += 1; }, onChanged: async (decision) => changes.push(decision) })), { container: container() });
      await screen.findByRole('spinbutton', { name: 'Approved spots' });
      await adjust('Decrease approved spots', 1);
      assert.equal(quantity('Approved spots'), 1);
      assert.equal(screen.getByRole('button', { name: 'Decrease approved spots' }).disabled, true);
      await adjust('Increase approved spots', 19);
      assert.equal(quantity('Approved spots'), 20);
      assert.equal(screen.getByRole('button', { name: 'Increase approved spots' }).disabled, true);
      assert.ok(screen.getByText('20 separate entry passes on approval.'));
      await user.click(screen.getByRole('button', { name: 'Approve request' }));
      assert.deepEqual(calls.find((call) => call.method === 'POST').body, { decision: 'approve', partySize: 20 });
      assert.equal(screen.getByRole('button', { name: 'Decrease approved spots' }).disabled, true);
      assert.equal(screen.getByRole('button', { name: 'Close guest details' }).disabled, true);
      await user.keyboard('{Escape}');
      assert.equal(closes, 0);
      await act(async () => release());
      await screen.findByRole('alert');
      assert.equal(quantity('Approved spots'), 20);
      assert.equal(changes.length, 0);
      await adjust('Decrease approved spots', 19);
      handler = (call) => response(call.method === 'POST' ? { entry: { ...pending, partySize: call.body.partySize, status: 'confirmed' } } : pending);
      await user.click(screen.getByRole('button', { name: 'Approve request' }));
      await waitFor(() => assert.equal(closes, 1));
      assert.deepEqual(calls.filter((call) => call.method === 'POST').at(-1).body, { decision: 'approve', partySize: 1 });
      assert.deepEqual(changes, ['approve']);
      reset();
    });

    await t.test('review draft follows authoritative selections and never resets on an unrelated detail refresh', async () => {
      reset();
      const second = { ...pending, id: 'second-fixture', guestName: 'Second Guest', partySize: 4 };
      handler = (call) => response(call.url.pathname.endsWith(second.id) ? second : { ...pending, partySize: 3 });
      const props = reviewProps();
      view = render(React.createElement(MyEventGuestDetail, props), { container: container() });
      await screen.findByRole('spinbutton', { name: 'Approved spots' });
      assert.equal(quantity('Approved spots'), 3);
      await adjust('Increase approved spots', 2);
      const field = screen.getByRole('spinbutton', { name: 'Approved spots' });
      view.rerender(React.createElement(MyEventGuestDetail, { ...props, detail: { ...detail } }));
      assert.equal(quantity('Approved spots'), 5);
      assert.equal(screen.getByRole('spinbutton', { name: 'Approved spots' }), field);
      assert.equal(calls.length, 1);
      view.rerender(React.createElement(MyEventGuestDetail, { ...props, selected: second }));
      await waitFor(() => assert.equal(quantity('Approved spots'), 4));
      assert.equal(calls.length, 2);
      reset();
    });

    await t.test('guest-detail retry initializes the approval draft from the freshly fetched request', async () => {
      reset();
      let fails = true;
      handler = () => fails ? response({ message: 'Guest details could not load.' }, 503) : response({ ...pending, partySize: 4 });
      view = render(React.createElement(MyEventGuestDetail, reviewProps({ ...pending, partySize: 8 })), { container: container() });
      await screen.findByRole('button', { name: 'Retry guest details' });
      assert.equal(screen.queryByRole('spinbutton', { name: 'Approved spots' }), null);
      fails = false;
      await user.click(screen.getByRole('button', { name: 'Retry guest details' }));
      await screen.findByRole('spinbutton', { name: 'Approved spots' });
      assert.equal(quantity('Approved spots'), 4);
      assert.equal(calls.length, 2);
      reset();
    });

    await t.test('approval quantities are hidden for unauthorized, finished, approved and admitted entries', async () => {
      for (const [entry, currentCapabilities, currentDetail] of [
        [pending, { ...capabilities, canReviewGuestlist: false }, detail],
        [pending, { ...capabilities, readOnly: true }, detail],
        [pending, capabilities, { ...detail, event: { ...event, status: 'completed' } }],
        [{ ...pending, status: 'confirmed' }, capabilities, detail],
        [{ ...pending, status: 'checked_in', checkedInSpots: 1 }, capabilities, detail],
        [{ ...pending, checkedInSpots: 1 }, capabilities, detail],
      ]) {
        reset(); handler = () => response(entry);
        view = render(React.createElement(MyEventGuestDetail, reviewProps(entry, { capabilities: currentCapabilities, detail: currentDetail })), { container: container() });
        await waitFor(() => assert.equal(screen.getByRole('dialog').getAttribute('aria-busy'), 'false'));
        assert.equal(screen.queryByRole('spinbutton', { name: 'Approved spots' }), null);
        const approve = screen.queryByRole('button', { name: 'Approve request' });
        assert.ok(!approve || approve.disabled);
        assert.equal(calls.some((call) => call.method === 'POST'), false);
      }
      reset();
    });
  } finally {
    view?.unmount(); await vite?.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
