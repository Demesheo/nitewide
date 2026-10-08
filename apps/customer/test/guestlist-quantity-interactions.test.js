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
  let handler, vite, view, React, render, screen, within, waitFor, act, user, App, AccountDialog, MyEventGuestDetail;
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
    ({ render, screen, within, waitFor, act } = await import('@testing-library/react'));
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

    await t.test('Booked navigation issues one read under StrictMode and ignores focus, visibility and ordinary rerenders', async (subtest) => {
      reset();
      const empty = { page: 1, pageSize: 10, total: 0, orders: [], guestlists: [], entries: [] };
      const props = { open: true, embedded: true, session, onOpenChange() {} };
      const strict = (value) => React.createElement(React.StrictMode, null, React.createElement(AccountDialog, value));
      handler = () => response(empty);
      view = render(strict(props), { container: container() });
      await screen.findByText('Something to look forward to.');
      assert.equal(calls.length, 1, 'StrictMode does not start a canceled duplicate bookings request');
      assert.equal(calls[0].signal.aborted, false);
      subtest.mock.timers.enable({ apis: ['setInterval'] });
      await act(async () => {
        subtest.mock.timers.tick(30_000);
        dom.window.dispatchEvent(new dom.window.Event('focus'));
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      });
      subtest.mock.timers.reset();
      view.rerender(strict({ ...props, session: { ...session, user: { ...session.user } } }));
      assert.equal(calls.length, 1);
      view.rerender(strict({ ...props, bookingsRevision: 1 }));
      await waitFor(() => assert.equal(calls.length, 2));
      await user.click(screen.getByRole('button', { name: 'Refresh bookings' }));
      assert.equal(calls.length, 3, 'explicit actions can refresh the current page');
      view.rerender(strict({ ...props, bookingsRevision: 1, open: false }));
      view.rerender(strict({ ...props, bookingsRevision: 1 }));
      await waitFor(() => assert.equal(calls.length, 4));
      reset();
      const ticket = { id: pending.id, kind: 'guestlist', partySize: 2, event, tickets: [{ id: 'linked-pass', status: 'pending', offering: 'Guestlist', qrImage: null }] };
      handler = () => response(ticket);
      view = render(strict({ ...props, bookingRoute: `guestlist:${ticket.id}` }), { container: container() });
      await screen.findByRole('article', { name: 'Guest list entry: Pending review' });
      assert.equal(calls.length, 1, 'a deep link opens its pass without starting a bookings read');
      assert.equal(calls[0].url.pathname, `/api/customer/guestlists/${ticket.id}/pass`);
      assert.equal(calls[0].signal.aborted, false);
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
      let releaseSaved;
      handler = (call) => new Promise((resolve) => { if (call.method === 'PATCH') releaseSaved = () => resolve(response({ entry: { id: ticket.id, status: 'pending', partySize: call.body.partySize } })); });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
      await user.click(screen.getByRole('button', { name: 'Save spots' }));
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
      assert.equal(screen.getByRole('button', { name: 'Refresh pass' }).disabled, true);
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/pass')).length, 0, 'window focus does not reread a pass or interrupt a quantity save');
      await act(async () => releaseSaved());
      await screen.findByRole('button', { name: 'Edit spots' });
      await user.click(screen.getByRole('button', { name: 'Edit spots' }));
      assert.equal(quantity('Spots'), 5, 'the saved response updates the quantity');
      assert.equal(screen.getByRole('button', { name: 'Save spots' }).disabled, true);
      reset();
    });

    await t.test('approval notification replaces five requested spots with four distinct passes and a current Booked card without manual refresh', async () => {
      reset();
      const changedEvent = { ...event, startsAt: '2099-10-04T23:00:00Z', endsAt: '2099-10-05T03:00:00Z' };
      const requested = { id: pending.id, partySize: 5, status: 'pending', event };
      const approved = { ...requested, kind: 'guestlist', partySize: 4, status: 'confirmed', event: changedEvent, tickets: Array.from({ length: 4 }, (_, index) => ({ id: `approved-pass-${index + 1}`, spots: 1, status: 'confirmed', offering: 'Guestlist', qrImage: `data:image/png;base64,fixture-${index + 1}` })) };
      const other = { id: 'other-booking', partySize: 1, status: 'confirmed', event: { ...event, id: 'other-event', title: 'Other Night', startsAt: '2099-10-03T23:00:00Z' } };
      const page = (guestlists) => ({ page: 1, pageSize: 10, total: guestlists.length, orders: [], guestlists, entries: guestlists.map(({ id }) => ({ kind: 'guestlist', id })) });
      let releaseBookings;
      handler = () => calls.length === 1 ? response(page([requested, other])) : new Promise((resolve) => { releaseBookings = () => resolve(response(page([other, approved]))); });
      function BookedFixture({ notification }) {
        const [route, setRoute] = React.useState(null), [incoming, setIncoming] = React.useState(null);
        React.useEffect(() => { if (notification) { setRoute(`guestlist:${notification.ticket.id}`); setIncoming(notification); } }, [notification]);
        const clearNotification = React.useCallback(() => setIncoming(null), []);
        return React.createElement(AccountDialog, { open: true, embedded: true, session, notificationBooking: incoming, bookingRoute: route, onBookingRouteChange: setRoute, onNotificationOpened: clearNotification, onOpenChange() {} });
      }
      view = render(React.createElement(BookedFixture), { container: container() });
      const originalCard = await screen.findByRole('button', { name: 'View guest list entry for Fixture Night, 5 Guest list entry' });
      assert.match(originalCard.textContent, /Awaiting approval/);
      view.rerender(React.createElement(BookedFixture, { notification: { ticket: approved } }));
      await screen.findByText('Pass 1 of 4');
      const images = [], ids = [];
      for (let index = 0; index < 4; index += 1) {
        images.push(screen.getByRole('img', { name: /QR code for guest list pass/ }).getAttribute('src'));
        ids.push(screen.getByText(`approved-pass-${index + 1}`).textContent);
        if (index < 3) await user.click(screen.getByRole('button', { name: 'Next pass' }));
      }
      assert.equal(new Set(images).size, 4);
      assert.equal(new Set(ids).size, 4);
      assert.equal(calls.length, 1, 'an already-loaded notification pass does not duplicate the pass or list request');
      await user.click(screen.getByRole('button', { name: 'Back to my nights' }));
      await waitFor(() => assert.equal(typeof releaseBookings, 'function'));
      const currentCard = screen.getByRole('button', { name: 'View guest list entry for Fixture Night, 4 Guest list entry' });
      assert.ok(within(currentCard).getByText('Approved'));
      assert.match(currentCard.textContent, /4 guests/);
      const date = (source) => new Date(source.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: source.location.timezone });
      assert.ok(currentCard.textContent.includes(date(changedEvent)));
      assert.equal(currentCard.textContent.includes(date(event)), false);
      assert.equal(screen.queryByText('Finding your nights…'), null, 'background revalidation does not shift the restored list');
      await act(async () => releaseBookings());
      assert.deepEqual(Array.from(container().querySelectorAll('.purchase-card')).map((card) => card.dataset.ticketId), [other.id, requested.id], 'the server refresh updates timeline ordering after a date change');
      assert.ok(screen.getByRole('button', { name: 'View guest list entry for Fixture Night, 4 Guest list entry' }) === currentCard, 'revalidation retains the current card element');
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.url.pathname === '/api/customer/bookings' && !call.body), 'this display update issues no credentials or mutations');
      reset();
    });

    await t.test('opening and explicitly refreshing a pass reconcile its quantity and date while return restores focus and scroll', async () => {
      reset();
      const requested = { id: pending.id, partySize: 5, status: 'pending', event };
      const changedEvent = { ...event, startsAt: '2099-10-06T23:00:00Z', endsAt: '2099-10-07T03:00:00Z' };
      const approved = { ...requested, kind: 'guestlist', partySize: 4, status: 'confirmed', event: changedEvent, tickets: Array.from({ length: 4 }, (_, index) => ({ id: `polled-pass-${index}`, spots: 1, status: 'confirmed', offering: 'Guestlist', qrImage: `data:image/png;base64,polled-${index}` })) };
      const page = (entry) => ({ page: 1, total: 1, orders: [], guestlists: [entry], entries: [{ kind: 'guestlist', id: entry.id }] });
      let currentPass = { ...approved, partySize: 5, event, status: 'pending', tickets: [{ id: 'pending-pass', status: 'pending', offering: 'Guestlist', qrImage: null }] };
      const scrolls = [], oldScrollTo = dom.window.scrollTo;
      Object.defineProperty(dom.window, 'scrollY', { configurable: true, value: 420 });
      dom.window.scrollTo = (value) => scrolls.push(value.top);
      handler = (call) => response(call.url.pathname.endsWith('/pass') ? currentPass : page(calls.filter((entry) => entry.url.pathname.endsWith('/bookings')).length === 1 ? requested : approved));
      function BookedFixture() {
        const [route, setRoute] = React.useState(null);
        return React.createElement(AccountDialog, { open: true, embedded: true, session, bookingRoute: route, onBookingRouteChange: setRoute, onOpenChange() {} });
      }
      view = render(React.createElement(BookedFixture), { container: container() });
      await user.click(await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 5/ }));
      await screen.findByText('Pending review');
      currentPass = approved;
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/pass')).length, 1, 'focus does not reread an open pass');
      await user.click(screen.getByRole('button', { name: 'Refresh pass' }));
      await screen.findByText('Pass 1 of 4');
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/pass')).length, 2, 'route synchronization does not duplicate an opened pass request');
      await user.click(screen.getByRole('button', { name: 'Back to my nights' }));
      const card = await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 4/ });
      assert.ok(within(card).getByText('Approved'));
      assert.match(card.textContent, /Oct 6/);
      assert.ok(dom.window.document.activeElement === card);
      assert.equal(scrolls.at(-1), 420);
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/bookings')).length, 2);
      dom.window.scrollTo = oldScrollTo;
      reset();
    });

    await t.test('passes do not poll or refresh on focus, and explicit refresh clears unavailable admission caches', async (subtest) => {
      reset();
      const approved = { id: pending.id, kind: 'guestlist', partySize: 4, status: 'confirmed', event, tickets: Array.from({ length: 4 }, (_, index) => ({ id: `status-pass-${index}`, spots: 1, status: 'confirmed', offering: 'Guestlist', qrImage: `data:image/png;base64,status-${index}` })) };
      const page = { page: 1, total: 1, orders: [], guestlists: [approved], entries: [{ kind: 'guestlist', id: approved.id }] };
      let releasePass;
      handler = (call) => call.url.pathname.endsWith('/pass') ? new Promise((resolve) => { releasePass = (pass) => resolve(response(pass)); }) : response(page);
      view = render(React.createElement(AccountDialog, { open: true, embedded: true, session, notificationBooking: { ticket: approved }, onOpenChange() {} }), { container: container() });
      await screen.findByText('Pass 1 of 4');
      subtest.mock.timers.enable({ apis: ['setInterval'] });
      await act(async () => subtest.mock.timers.tick(15_000));
      subtest.mock.timers.reset();
      assert.equal(calls.length, 0, 'an open pass makes no timer reads');
      const cacheKey = `nitewide.passes:${session.user.id}:guestlist:${approved.id}`;
      assert.ok(dom.window.localStorage.getItem(cacheKey));
      Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: true });
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); });
      assert.equal(calls.length, 0);
      Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
      await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); dom.window.dispatchEvent(new dom.window.Event('focus')); });
      assert.equal(calls.length, 0, 'focus and visibility events do not reread the pass');
      await user.click(screen.getByRole('button', { name: 'Refresh pass' }));
      await user.click(screen.getByRole('button', { name: 'Refresh pass' }));
      assert.equal(calls.length, 1, 'explicit refresh disables overlapping reads');
      const revoked = { ...approved, status: 'rejected', tickets: approved.tickets.map((pass) => ({ ...pass, status: 'rejected', qrImage: null })) };
      await act(async () => releasePass(revoked));
      await screen.findByRole('article', { name: 'Guest list pass 1: Declined' });
      assert.equal(dom.window.localStorage.getItem(cacheKey), null);
      assert.equal(screen.queryByRole('img', { name: /QR code/ }), null);
      for (const pass of [
        { ...approved, event: { ...event, status: 'cancelled' }, tickets: approved.tickets.map((ticket) => ({ ...ticket, qrImage: null })) },
        { ...approved, status: 'checked_in', tickets: approved.tickets.map((ticket) => ({ ...ticket, status: 'checked_in', qrImage: null })) },
      ]) {
        await user.click(screen.getByRole('button', { name: 'Refresh pass' }));
        await act(async () => releasePass(pass));
        assert.equal(dom.window.localStorage.getItem(cacheKey), null);
        assert.equal(screen.queryByRole('img', { name: /QR code/ }), null);
      }
      assert.ok(screen.getByText('4 of 4 checked in'));
      delete dom.window.document.hidden;
      reset();
    });

    await t.test('deep-linked passes retry explicitly, recheck renewed credentials and discard revoked cached admission', async () => {
      reset();
      const approved = { id: pending.id, kind: 'guestlist', partySize: 1, status: 'confirmed', event, tickets: [{ id: 'credential-pass', spots: 1, status: 'confirmed', offering: 'Guestlist', qrImage: 'data:image/png;base64,credential' }] };
      const props = { open: true, embedded: true, session, bookingRoute: `guestlist:${approved.id}`, onOpenChange() {} };
      let fails = true;
      handler = () => response(fails ? { message: 'Temporary pass failure.' } : approved, fails ? 503 : 200);
      view = render(React.createElement(AccountDialog, props), { container: container() });
      await screen.findByRole('alert');
      assert.equal(calls.length, 1);
      fails = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('img', { name: /QR code/ });
      assert.equal(calls.length, 2, 'retry reopens the deep-linked pass without fetching the timeline');
      const cacheKey = `nitewide.passes:${session.user.id}:guestlist:${approved.id}`;
      assert.ok(dom.window.localStorage.getItem(cacheKey));
      handler = () => response({ message: 'This booking is no longer available.' }, 403);
      view.rerender(React.createElement(AccountDialog, { ...props, session: { ...session, accessToken: 'renewed-token' } }));
      await screen.findByRole('alert');
      assert.equal(calls.length, 3);
      assert.equal(calls.at(-1).headers.Authorization, 'Bearer renewed-token');
      assert.equal(dom.window.localStorage.getItem(cacheKey), null);
      assert.equal(screen.queryByRole('img', { name: /QR code/ }), null);
      assert.ok(calls.every((call) => call.url.pathname.endsWith('/pass')));
      reset();
    });

    await t.test('returning from an in-flight manual pass refresh aborts it and keeps the current bookings page', async () => {
      reset();
      const entry = { id: pending.id, kind: 'guestlist', partySize: 1, status: 'confirmed', event, tickets: [{ id: 'manual-pass', spots: 1, status: 'confirmed', offering: 'Guestlist', qrImage: 'data:image/png;base64,manual' }] };
      const page = { page: 1, pageSize: 10, total: 1, orders: [], guestlists: [entry], entries: [{ kind: 'guestlist', id: entry.id }] };
      let releasePass;
      handler = (call) => response(call.url.pathname.endsWith('/pass') ? entry : page);
      function BookedFixture() {
        const [route, setRoute] = React.useState(null);
        return React.createElement(AccountDialog, { open: true, embedded: true, session, bookingRoute: route, onBookingRouteChange: setRoute, onOpenChange() {} });
      }
      view = render(React.createElement(BookedFixture), { container: container() });
      await user.click(await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 1/ }));
      await screen.findByRole('img', { name: /QR code/ });
      handler = (call) => call.url.pathname.endsWith('/pass') ? new Promise((resolve) => { releasePass = () => resolve(response(entry)); }) : response(page);
      await user.click(screen.getByRole('button', { name: 'Refresh pass' }));
      const request = calls.at(-1);
      await user.click(screen.getByRole('button', { name: 'Back to my nights' }));
      await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 1/ });
      assert.equal(request.signal.aborted, true);
      await act(async () => releasePass());
      assert.equal(screen.queryByRole('button', { name: 'Back to my nights' }), null);
      assert.equal(screen.queryByRole('img', { name: /QR code/ }), null);
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/bookings')).length, 2);
      reset();
    });

    await t.test('return revalidation removes a moved night from its old period and repairs a now-empty page', async () => {
      reset();
      const requested = { id: pending.id, partySize: 5, status: 'pending', event };
      const moved = { ...requested, kind: 'guestlist', partySize: 4, status: 'confirmed', event: { ...event, startsAt: '2000-10-02T23:00:00Z', endsAt: '2000-10-03T03:00:00Z' }, tickets: [{ id: 'expired-pass', status: 'confirmed', qrImage: null, offering: 'Guestlist' }] };
      const other = { ...requested, id: 'remaining-night', event: { ...event, id: 'remaining-event', title: 'Remaining Night' } };
      const page = (entries, number, total) => ({ page: number, pageSize: 10, total, orders: [], guestlists: entries, entries: entries.map(({ id }) => ({ kind: 'guestlist', id })) });
      let updated = false;
      handler = (call) => {
        if (call.url.pathname.endsWith('/pass')) { updated = true; return response(moved); }
        const number = Number(call.url.searchParams.get('page'));
        if (call.url.searchParams.get('period') === 'past') return response(page([moved], 1, 1));
        return response(number === 2 ? page(updated ? [] : [requested], 2, updated ? 10 : 11) : page([other], 1, updated ? 10 : 11));
      };
      function BookedFixture() {
        const [route, setRoute] = React.useState(null);
        return React.createElement(AccountDialog, { open: true, embedded: true, session, bookingRoute: route, onBookingRouteChange: setRoute, onOpenChange() {} });
      }
      view = render(React.createElement(BookedFixture), { container: container() });
      await screen.findByRole('button', { name: /View guest list entry for Remaining Night/ });
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 5/ }));
      await screen.findByRole('button', { name: 'Back to my nights' });
      await user.click(screen.getByRole('button', { name: 'Back to my nights' }));
      await screen.findByRole('button', { name: /View guest list entry for Remaining Night/ });
      assert.equal(screen.queryByText('Fixture Night'), null);
      assert.equal(screen.queryByRole('button', { name: 'Next' }), null);
      const requests = calls.filter((call) => call.url.pathname.endsWith('/bookings')).map((call) => [call.url.searchParams.get('period'), call.url.searchParams.get('page')]);
      assert.deepEqual(requests, [['upcoming', '1'], ['upcoming', '2'], ['upcoming', '2'], ['upcoming', '1']]);
      await user.click(screen.getByRole('button', { name: 'Past nights' }));
      const movedCard = await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 4/ });
      assert.ok(within(movedCard).getByText('Approved'));
      assert.equal(screen.getByRole('button', { name: 'Past nights' }).getAttribute('aria-pressed'), 'true');
      reset();
    });

    await t.test('late booking and pass responses cannot cross account identities or survive unmount', async () => {
      reset();
      const requested = { id: pending.id, partySize: 5, status: 'pending', event };
      const page = { page: 1, total: 1, orders: [], guestlists: [requested], entries: [{ kind: 'guestlist', id: requested.id }] };
      const empty = { page: 1, total: 0, orders: [], guestlists: [], entries: [] };
      const pass = { ...requested, kind: 'guestlist', tickets: [{ id: 'late-pass', status: 'pending', qrImage: null, offering: 'Guestlist' }] };
      let releasePass, releaseBookings;
      const props = { open: true, embedded: true, session, onOpenChange() {} };
      handler = () => response(page);
      view = render(React.createElement(AccountDialog, props), { container: container() });
      const card = await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 5/ });
      handler = (call) => new Promise((resolve) => { if (call.url.pathname.endsWith('/pass')) releasePass = () => resolve(response(pass)); else releaseBookings = () => resolve(response(page)); });
      await user.click(screen.getByRole('button', { name: 'Refresh bookings' }));
      await user.click(card);
      await waitFor(() => assert.equal(typeof releasePass, 'function'));
      const oldRequests = calls.slice(-2);
      handler = () => response(empty);
      view.rerender(React.createElement(AccountDialog, { ...props, session: { accessToken: 'other-token', user: { ...session.user, id: 'other-customer' } } }));
      await screen.findByText('Something to look forward to.');
      assert.ok(oldRequests.every((call) => call.signal.aborted));
      await act(async () => { releaseBookings(); releasePass(); });
      assert.equal(screen.queryByText('Fixture Night'), null);
      assert.equal(screen.queryByRole('button', { name: 'Back to my nights' }), null);
      assert.equal(dom.window.localStorage.getItem(`nitewide.passes:other-customer:guestlist:${pass.id}`), null);
      reset();
      handler = (call) => response(call.url.pathname.endsWith('/pass') ? pass : page);
      const linked = { ...props, bookingRoute: `guestlist:${pass.id}` };
      view = render(React.createElement(AccountDialog, linked), { container: container() });
      await screen.findByRole('article', { name: 'Guest list entry: Pending review' });
      handler = (call) => response(call.url.pathname.endsWith('/pass') ? { message: 'This booking is not yours.' } : empty, call.url.pathname.endsWith('/pass') ? 403 : 200);
      view.rerender(React.createElement(AccountDialog, { ...linked, session: { accessToken: 'other-token', user: { ...session.user, id: 'other-customer' } } }));
      await screen.findByText(/This booking could not be opened: This booking is not yours/);
      assert.equal(screen.queryByRole('article', { name: 'Guest list entry: Pending review' }), null);
      assert.equal(calls.filter((call) => call.url.pathname.endsWith('/pass')).length, 2, 'a carried deep link is checked under the new identity');
      reset();
      handler = () => response(page);
      view = render(React.createElement(AccountDialog, props), { container: container() });
      await screen.findByRole('button', { name: /View guest list entry for Fixture Night, 5/ });
      handler = (call) => call.url.pathname.endsWith('/pass') ? new Promise((resolve) => { releasePass = () => resolve(response(pass)); }) : response(page);
      await user.click(screen.getByRole('button', { name: /View guest list entry for Fixture Night, 5/ }));
      const pendingOpen = calls.at(-1);
      view.rerender(React.createElement(AccountDialog, { ...props, session: { ...session, accessToken: 'renewed-token' } }));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: /View guest list entry for Fixture Night, 5/ }).disabled, false));
      assert.equal(pendingOpen.signal.aborted, true);
      await act(async () => releasePass());
      assert.equal(screen.queryByRole('button', { name: 'Back to my nights' }), null);
      reset();
      handler = () => new Promise((resolve) => { releaseBookings = () => resolve(response(page)); });
      view = render(React.createElement(AccountDialog, props), { container: container() });
      await waitFor(() => assert.equal(calls.length, 1));
      const unfinished = calls[0];
      view.unmount(); view = null;
      assert.equal(unfinished.signal.aborted, true);
      await act(async () => releaseBookings());
      assert.equal(container().textContent, '');
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
