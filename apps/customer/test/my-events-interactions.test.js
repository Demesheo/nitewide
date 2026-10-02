import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('My events respects explicit search, scoped finances, capability checks and cancelled account requests', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const previousFetch = globalThis.fetch;
  let vite, view;
  const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  const secondId = '2a0200bf-9d74-46b0-8fa0-a24a6908a4b1';
  const event = { id: eventId, title: 'Night at Lounge', status: 'published', startsAt: '2099-10-02T23:00:00Z', endsAt: '2099-10-03T03:00:00Z', location: { name: 'The Lounge', city: 'Orlando', timezone: 'America/New_York' }, scope: 'event', lifetimeSales: { salesCents: 12000, paidOrders: 4 }, canManage: true };
  const page = (items, overrides = {}) => ({ items, total: 24, page: 1, pageSize: 12, hasMore: true, counts: { upcoming: 24, past: 3 }, ...overrides });
  const response = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  const container = () => { dom.window.document.body.innerHTML = '<div id="root"></div>'; return dom.window.document.getElementById('root'); };
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { MyEventsPage } = await vite.ssrLoadModule('/src/components/my-events-page.jsx');
    const { MyEventStats, MyEventDetail } = await vite.ssrLoadModule('/src/components/my-event-detail.jsx');
    const { MyEventsAccessState } = await vite.ssrLoadModule('/src/components/my-events-access-state.jsx');
    const { useMyEventsAccess } = await vite.ssrLoadModule('/src/lib/use-my-events-access.js');
    await vite.transformRequest('/src/App.jsx');
    const React = await import('react');
    const { render, screen, waitFor, act } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const access = { eligible: true, loading: false, error: '', recheck() {} };

    await t.test('the lightweight access gate handles signed-out and denied customers without operator content', async () => {
      let signIns = 0, discoveries = 0, retries = 0;
      const props = { session: null, access: { eligible: false, loading: false, error: '', recheck() { retries += 1; } }, onSignIn() { signIns += 1; }, onDiscover() { discoveries += 1; } };
      view = render(React.createElement(MyEventsAccessState, props), { container: container() });
      await user.click(screen.getByRole('button', { name: 'Sign in' }));
      assert.equal(signIns, 1);
      view.rerender(React.createElement(MyEventsAccessState, { ...props, session: { accessToken: 'customer' } }));
      assert.ok(screen.getByRole('heading', { name: 'Your event access isn’t available.' }));
      await user.click(screen.getByRole('button', { name: 'Discover events' }));
      assert.equal(discoveries, 1);
      assert.equal(screen.queryByRole('heading', { name: 'Event performance' }), null);
      view.rerender(React.createElement(MyEventsAccessState, { ...props, session: { accessToken: 'customer' }, access: { ...props.access, error: 'Could not check access' } }));
      assert.equal(screen.getByRole('alert').textContent.includes('Could not check access'), true);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      assert.equal(retries, 1);
      view.unmount(); view = null;
    });

    await t.test('typing never requests search; submission resets pagination and cards select internal operations', async () => {
      const calls = [], changes = [];
      globalThis.fetch = async path => { calls.push(String(path)); return response(page([event])); };
      let route = { myStatus: 'upcoming', myPage: 3, mySearch: '', myEventId: null };
      const props = { session: { accessToken: 'operator' }, access, route, onRouteChange: next => changes.push(next), onUnauthorized() {} };
      view = render(React.createElement(MyEventsPage, props), { container: container() });
      await screen.findByRole('button', { name: 'View Night at Lounge operations' });
      assert.equal(new URL(calls[0], 'http://localhost').searchParams.get('page'), '3');
      await user.type(screen.getByRole('searchbox', { name: 'Search your events' }), 'Lounge');
      assert.equal(calls.length, 1);
      await user.keyboard('{Enter}');
      assert.equal(changes.at(-1).mySearch, 'Lounge'); assert.equal(changes.at(-1).myPage, 1);
      route = changes.at(-1);
      view.rerender(React.createElement(MyEventsPage, { ...props, route }));
      await waitFor(() => assert.equal(calls.length, 2));
      assert.equal(new URL(calls.at(-1), 'http://localhost').searchParams.get('search'), 'Lounge');
      await screen.findByRole('button', { name: 'View Night at Lounge operations' });
      await user.click(screen.getByRole('button', { name: /Next/ }));
      assert.equal(changes.at(-1).myPage, 2);
      await user.click(screen.getByRole('button', { name: 'View Night at Lounge operations' }));
      assert.equal(changes.at(-1).myEventId, eventId);
      assert.equal(calls.some(path => /^\/api\/events\//.test(path)), false);
      view.unmount(); view = null;
    });

    await t.test('account switches abort old pages and late financial responses never render', async () => {
      const pending = [];
      globalThis.fetch = async (_path, options) => new Promise(resolve => pending.push({ signal: options.signal, resolve }));
      const props = { session: { accessToken: 'first-token' }, access, route: { myStatus: 'upcoming', myPage: 1, mySearch: '', myEventId: null }, onRouteChange() {}, onUnauthorized() {} };
      view = render(React.createElement(MyEventsPage, props), { container: container() });
      await waitFor(() => assert.equal(pending.length, 1));
      view.rerender(React.createElement(MyEventsPage, { ...props, session: { accessToken: 'second-token' } }));
      await waitFor(() => assert.equal(pending.length, 2));
      assert.equal(pending[0].signal.aborted, true);
      await act(async () => {
        pending[1].resolve(response(page([{ ...event, id: secondId, title: 'Second account event' }])));
        pending[0].resolve(response(page([event])));
      });
      await screen.findByRole('button', { name: 'View Second account event operations' });
      assert.equal(screen.queryByText('Night at Lounge'), null);
      view.rerender(React.createElement(MyEventsPage, { ...props, session: null, access: { ...access, eligible: false } }));
      assert.equal(screen.queryByText('Second account event'), null);
      assert.ok(screen.getByRole('button', { name: 'Sign in' }));
      view.unmount(); view = null;
    });

    await t.test('background eligibility checks retain the loaded directory and do not fetch another page', async () => {
      const calls = [];
      let retries = 0;
      globalThis.fetch = async path => { calls.push(String(path)); return response(page([event])); };
      const confirmedAccess = { ...access, successRevision: 1, recheck() { retries += 1; } };
      const props = { session: { accessToken: 'operator' }, access: confirmedAccess, route: { myStatus: 'upcoming', myPage: 1, mySearch: '', myEventId: null }, onRouteChange() {}, onUnauthorized() {} };
      view = render(React.createElement(MyEventsPage, props), { container: container() });
      const card = await screen.findByRole('button', { name: 'View Night at Lounge operations' });
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, loading: true } }));
      assert.equal(screen.getByRole('button', { name: 'View Night at Lounge operations' }), card);
      assert.equal(calls.length, 1);
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, error: 'Connection unavailable' } }));
      assert.ok(screen.getByText('Couldn’t refresh your event access.'));
      await user.click(screen.getByRole('button', { name: 'Retry access check' }));
      assert.equal(retries, 1);
      assert.equal(calls.length, 1);
      assert.equal(screen.getByRole('button', { name: 'View Night at Lounge operations' }), card);
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, successRevision: 2 } }));
      await waitFor(() => assert.equal(calls.length, 2));
      assert.equal(screen.getByRole('button', { name: 'View Night at Lounge operations' }), card, 'successful access checks refresh the page while retaining its mounted cards');
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, eligible: false } }));
      assert.equal(screen.queryByRole('button', { name: 'View Night at Lounge operations' }), null);
      assert.ok(screen.getByRole('heading', { name: 'Your event access isn’t available.' }));
      view.unmount(); view = null;
    });

    await t.test('background access rechecks keep detail and a submitting invitation dialog mounted', async () => {
      const calls = [];
      let release;
      const detail = { event, scope: 'event', summary: { salesCents: 12000, orders: 4, admissions: 4, guestlistPlaces: 2, checkedIn: 1, commissionCents: 99999 }, personalEarnings: { earnedCommissionCents: 12345, demoCommissionCents: 0, sandboxCommissionCents: 0, unverifiedCommissionCents: 0, receivedPayouts: null, payoutsTracked: false }, tiers: [], capabilities: { readOnly: false, canShareReferral: true, canInviteGuestlist: true, canReviewGuestlist: true } };
      globalThis.fetch = async (path, options = {}) => {
        calls.push({ path: String(path), method: options.method || 'GET' });
        if (String(path).includes('/guestlist-page')) return response(page([], { total: 0, hasMore: false, pageSize: 10 }));
        if (String(path).includes('/guestlist-invite-pools')) return response({ direct: true, own: [], open: true });
        if (String(path).includes('/guestlist-invitations')) return new Promise(resolve => { release = () => resolve(response({ token: 'private-invitation', invitation: { name: 'Alex Focus', partySize: 1 }, entryId: 'new-entry' })); });
        return response(detail);
      };
      const confirmedAccess = { ...access, successRevision: 1 };
      const props = { session: { accessToken: 'operator' }, access: confirmedAccess, route: { myStatus: 'upcoming', myPage: 1, mySearch: '', myEventId: eventId }, onRouteChange() {}, onUnauthorized() {} };
      view = render(React.createElement(MyEventsPage, props), { container: container() });
      await screen.findByRole('heading', { name: 'Event performance' });
      const statsHeading = dom.window.document.getElementById('my-event-stats-heading');
      await user.click(screen.getByRole('button', { name: 'Invite a guest' }));
      const dialog = await screen.findByRole('dialog', { name: 'Invite a guest' });
      await waitFor(() => assert.equal(screen.getByLabelText('Guest name').disabled, false));
      await user.type(screen.getByLabelText('Guest name'), 'Alex Focus');
      await user.click(screen.getByRole('button', { name: 'Create invitation' }));
      await waitFor(() => assert.equal(typeof release, 'function'));
      const requestCount = calls.length;
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, loading: true } }));
      assert.equal(screen.getByRole('dialog', { name: 'Invite a guest' }), dialog);
      assert.equal(dom.window.document.getElementById('my-event-stats-heading'), statsHeading);
      assert.equal(screen.getByLabelText('Guest name').value, 'Alex Focus');
      assert.equal(screen.getByRole('button', { name: 'Checking space…' }).disabled, true);
      assert.equal(calls.length, requestCount);
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, error: 'Connection unavailable' } }));
      assert.equal(screen.getByRole('dialog', { name: 'Invite a guest' }), dialog);
      assert.match(dom.window.document.querySelector('.my-events-access-warning').textContent, /Couldn’t refresh your event access/);
      assert.equal(calls.length, requestCount);
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...confirmedAccess, successRevision: 2 } }));
      await waitFor(() => assert.equal(calls.length, requestCount + 1));
      assert.equal(screen.getByRole('dialog', { name: 'Invite a guest' }), dialog, 'an authoritative refresh with the same scope keeps the submitting dialog');
      assert.equal(screen.getByLabelText('Guest name').value, 'Alex Focus');
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      await act(async () => release());
      await screen.findByRole('dialog', { name: 'Your guest is on the list' });
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...access, eligible: false } }));
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(screen.queryByText('Your earned commission'), null);
      assert.equal(dom.window.document.getElementById('my-event-stats-heading'), null);
      assert.ok(screen.getByRole('heading', { name: 'Your event access isn’t available.' }));
      view.unmount(); view = null;
    });

    await t.test('successful access rechecks refresh event scope and clear controls inherited from a broader role', async () => {
      let scope = 'event';
      const calls = [];
      const earnings = { earnedCommissionCents: 0, demoCommissionCents: 0, sandboxCommissionCents: 0, unverifiedCommissionCents: 0, receivedPayouts: null, payoutsTracked: false };
      const managerGuest = { id: 'manager-guest', guestName: 'Manager only guest', status: 'pending', partySize: 1, createdAt: '2099-10-02T12:00:00Z' };
      globalThis.fetch = async path => {
        calls.push(String(path));
        if (String(path).includes('/guestlist-page')) return response(page(scope === 'event' ? [managerGuest] : [], { total: scope === 'event' ? 1 : 0, hasMore: false, pageSize: 10 }));
        if (String(path).includes('/guestlist-invite-pools')) return response({ direct: true, own: [], open: true });
        return response({ event, scope, summary: { salesCents: scope === 'event' ? 12000 : 3000, orders: 4, admissions: 4, guestlistPlaces: 2, checkedIn: 1, commissionCents: 99999 }, personalEarnings: earnings, tiers: [], capabilities: { readOnly: false, canShareReferral: true, canInviteGuestlist: scope === 'event', canReviewGuestlist: scope === 'event' } });
      };
      const props = { session: { accessToken: 'operator' }, access: { ...access, successRevision: 1 }, route: { myStatus: 'upcoming', myPage: 1, mySearch: '', myEventId: eventId }, onRouteChange() {}, onUnauthorized() {} };
      view = render(React.createElement(MyEventsPage, props), { container: container() });
      await screen.findByText('Manager only guest');
      await user.click(screen.getByRole('button', { name: 'Invite a guest' }));
      await screen.findByRole('dialog', { name: 'Invite a guest' });
      scope = 'own';
      view.rerender(React.createElement(MyEventsPage, { ...props, access: { ...access, successRevision: 2 } }));
      await screen.findByRole('heading', { name: 'Your performance' });
      await screen.findByRole('heading', { name: 'Your guestlist' });
      assert.equal(screen.queryByText('Manager only guest'), null);
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(screen.queryByRole('button', { name: 'Invite a guest' }), null);
      assert.equal(screen.queryByText('Total event commissions'), null);
      assert.ok(screen.getByText('$30.00'));
      assert.equal(calls.filter(path => path.split('?')[0].endsWith(eventId)).length, 2);
      view.unmount(); view = null;
    });

    await t.test('capability is token-scoped, checks once initially and rechecks when entering the view', async () => {
      const calls = [], pending = [];
      globalThis.fetch = async (_path, options) => { calls.push(options.headers.Authorization); if (calls.length <= 2) return response({ eligible: calls.length === 1 }); return new Promise(resolve => pending.push({ signal: options.signal, resolve })); };
      function Harness({ session, active }) { const state = useMyEventsAccess(session, active); return React.createElement('p', { 'data-testid': 'capability' }, `${state.eligible}:${state.loading}:${state.error}`); }
      view = render(React.createElement(Harness, { session: { accessToken: 'operator' }, active: false }), { container: container() });
      await waitFor(() => assert.equal(screen.getByTestId('capability').textContent, 'true:false:'));
      view.rerender(React.createElement(Harness, { session: { accessToken: 'operator' }, active: false }));
      assert.equal(calls.length, 1);
      view.rerender(React.createElement(Harness, { session: { accessToken: 'operator' }, active: true }));
      await waitFor(() => assert.equal(screen.getByTestId('capability').textContent, 'false:false:'));
      assert.equal(calls.length, 2);
      view.rerender(React.createElement(Harness, { session: { accessToken: 'third' }, active: true }));
      await waitFor(() => assert.equal(pending.length, 1));
      assert.equal(screen.getByTestId('capability').textContent, 'false:true:');
      view.rerender(React.createElement(Harness, { session: null, active: true }));
      assert.equal(pending[0].signal.aborted, true);
      await act(async () => pending[0].resolve(response({ eligible: true })));
      assert.equal(screen.getByTestId('capability').textContent, 'false:false:');
      view.unmount(); view = null;
    });

    await t.test('network and server recheck failures preserve confirmed access, but denial and account switches clear it', async () => {
      let mode = 'eligible', releaseOld;
      let oldSignal;
      globalThis.fetch = async (_path, options) => {
        if (mode === 'network') throw new TypeError('Connection interrupted');
        if (mode === 'server') return new Response(JSON.stringify({ error: { message: 'Try later' } }), { status: 503 });
        if (mode === 'forbidden') return new Response(JSON.stringify({ error: { message: 'Access removed' } }), { status: 403 });
        if (mode === 'unauthenticated') return new Response(JSON.stringify({ error: { message: 'Session expired' } }), { status: 401 });
        if (mode === 'pending') return new Promise(resolve => { oldSignal = options.signal; releaseOld = () => resolve(response({ eligible: true })); });
        return response({ eligible: mode === 'eligible' });
      };
      function Harness({ session }) { const state = useMyEventsAccess(session, true); return React.createElement('div', null, React.createElement('p', { 'data-testid': 'access-state' }, JSON.stringify({ eligible: state.eligible, loading: state.loading, error: state.error, revision: state.successRevision })), React.createElement('button', { onClick: state.recheck }, 'Retry test access')); }
      const state = () => JSON.parse(screen.getByTestId('access-state').textContent);
      view = render(React.createElement(Harness, { session: { accessToken: 'operator' } }), { container: container() });
      await waitFor(() => assert.deepEqual(state(), { eligible: true, loading: false, error: '', revision: 1 }));
      for (const failure of ['network', 'server']) {
        mode = failure;
        await user.click(screen.getByRole('button', { name: 'Retry test access' }));
        await waitFor(() => assert.equal(state().loading, false));
        assert.equal(state().eligible, true); assert.ok(state().error); assert.equal(state().revision, 1);
      }
      mode = 'ineligible';
      await user.click(screen.getByRole('button', { name: 'Retry test access' }));
      await waitFor(() => assert.deepEqual(state(), { eligible: false, loading: false, error: '', revision: 2 }));
      for (const denial of ['forbidden', 'unauthenticated']) {
        mode = 'eligible';
        await user.click(screen.getByRole('button', { name: 'Retry test access' }));
        await waitFor(() => assert.equal(state().eligible, true));
        mode = denial;
        await user.click(screen.getByRole('button', { name: 'Retry test access' }));
        await waitFor(() => assert.equal(state().loading, false));
        assert.equal(state().eligible, false); assert.equal(state().error, '');
      }
      mode = 'eligible';
      await user.click(screen.getByRole('button', { name: 'Retry test access' }));
      await waitFor(() => assert.equal(state().eligible, true));
      mode = 'pending';
      await user.click(screen.getByRole('button', { name: 'Retry test access' }));
      await waitFor(() => assert.equal(typeof releaseOld, 'function'));
      assert.equal(state().eligible, true); assert.equal(state().loading, true);
      mode = 'network';
      view.rerender(React.createElement(Harness, { session: { accessToken: 'another-account' } }));
      assert.equal(state().eligible, false);
      await waitFor(() => assert.equal(state().loading, false));
      assert.equal(state().eligible, false); assert.equal(state().revision, 0); assert.ok(state().error);
      assert.equal(oldSignal.aborted, true);
      await act(async () => releaseOld());
      assert.equal(state().eligible, false, 'a late success from the previous token cannot restore access');
      view.unmount(); view = null;
    });

    await t.test('personal earnings never become event commissions or an invented paid payout', async () => {
      const detail = { scope: 'event', summary: { salesCents: 12000, orders: 4, admissions: 4, guestlistPlaces: 2, checkedIn: 1, commissionCents: 99999 }, personalEarnings: { earnedCommissionCents: 12345, demoCommissionCents: 0, sandboxCommissionCents: 0, unverifiedCommissionCents: 0, receivedPayouts: null, payoutsTracked: false }, tiers: [] };
      view = render(React.createElement(MyEventStats, { detail }), { container: container() });
      assert.ok(screen.getByText('$123.45')); assert.ok(screen.getByText('$999.99'));
      assert.ok(screen.getByText('Unavailable')); assert.ok(screen.getByText('Not yet tracked'));
      view.rerender(React.createElement(MyEventStats, { detail: { ...detail, scope: 'own' } }));
      assert.equal(screen.queryByText('Total event commissions'), null); assert.equal(screen.queryByText('$999.99'), null);
      assert.ok(screen.getByText('Your referred sales')); assert.ok(screen.getByText('Only your attributed activity'));
      view.rerender(React.createElement(MyEventStats, { detail: { ...detail, personalEarnings: { ...detail.personalEarnings, earnedCommissionCents: 0 } } }));
      assert.ok(screen.getByText('Recorded totals may include demo or sandbox activity and are not a payout or settlement statement.'));
      assert.ok(screen.getByText('$999.99'), 'event-wide commission remains distinct from a manager’s zero personal commission');
      assert.ok(screen.getByText('Unavailable'));
      assert.equal(screen.queryByText(/Recorded commission includes/), null, 'generic totals do not invent a personal demo commission amount');
      view.unmount(); view = null;
    });

    await t.test('detail access loss clears previously rendered finances before recovering access', async () => {
      const failures = [];
      let denied = false;
      const detail = { event, scope: 'event', summary: { salesCents: 12000, orders: 4, admissions: 4, guestlistPlaces: 2, checkedIn: 1, commissionCents: 99999 }, personalEarnings: { earnedCommissionCents: 12345, demoCommissionCents: 0, sandboxCommissionCents: 0, unverifiedCommissionCents: 0, receivedPayouts: null, payoutsTracked: false }, tiers: [], capabilities: { readOnly: true, canShareReferral: false, canInviteGuestlist: false, canReviewGuestlist: false } };
      globalThis.fetch = async path => {
        if (String(path).includes('/guestlist-page')) return response(page([], { total: 0, hasMore: false }));
        return denied ? new Response(JSON.stringify({ error: { code: 'BUSINESS_ACCESS_REQUIRED', message: 'Access lost' } }), { status: 403 }) : response(detail);
      };
      view = render(React.createElement(MyEventDetail, { session: { accessToken: 'operator' }, eventId, onBack() {}, onUnauthorized: cause => failures.push(cause) }), { container: container() });
      await screen.findByText('Your earned commission');
      assert.ok(screen.getByText('$123.45'));
      denied = true;
      await user.click(screen.getByRole('button', { name: 'Refresh event details' }));
      await waitFor(() => assert.equal(failures.length, 1));
      assert.equal(failures[0].status, 403);
      assert.equal(screen.queryByText('Your earned commission'), null);
      assert.equal(screen.queryByText('$123.45'), null);
      assert.equal(screen.queryByText('$999.99'), null);
      view.unmount(); view = null;
    });
  } finally {
    view?.unmount(); await vite?.close(); globalThis.fetch = previousFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
