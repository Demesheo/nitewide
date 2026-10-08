import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('My event detail waits for access and keeps scoped reads stable under StrictMode', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
  const previousFetch = globalThis.fetch;
  const eventId = '61daf017-d30c-4030-9b89-dd29d875ddaf';
  const detail = {
    event: { id: eventId, title: 'Scoped event', status: 'published', startsAt: '2099-10-02T23:00:00Z', endsAt: '2099-10-03T03:00:00Z', location: { name: 'The Lounge', city: 'Orlando', timezone: 'America/New_York' } },
    scope: 'event', summary: { salesCents: 12000, orders: 4, admissions: 4, guestlistPlaces: 2, checkedIn: 1, commissionCents: 0 },
    personalEarnings: { earnedCommissionCents: 0, demoCommissionCents: 0, sandboxCommissionCents: 0, unverifiedCommissionCents: 0, receivedPayouts: null, payoutsTracked: false },
    tiers: [], capabilities: { readOnly: false, canShareReferral: false, canInviteGuestlist: true, canReviewGuestlist: true },
  };
  const guestPage = { items: [], total: 0, page: 1, pageSize: 10, hasMore: false };
  const response = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { MyEventDetail } = await vite.ssrLoadModule('/src/components/my-event-detail.jsx');
    const React = await import('react');
    const { render, screen, waitFor, act } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { session: { accessToken: 'operator' }, eventId, refreshKey: 1, onBack() {}, onUnauthorized() {} };
    const strict = overrides => React.createElement(React.StrictMode, null, React.createElement(MyEventDetail, { ...props, ...overrides }));
    const reset = () => { view?.unmount(); view = null; dom.window.document.body.innerHTML = '<div id="root"></div>'; };

    await t.test('initial access gates both reads, background checks retain content, and confirmed/manual refreshes read once', async () => {
      const calls = [];
      globalThis.fetch = async (path, options) => { calls.push({ path: String(path), signal: options.signal }); return response(String(path).includes('/guestlist-page') ? guestPage : detail); };
      view = render(strict({ accessChecking: true }), { container: dom.window.document.getElementById('root') });
      await act(async () => {});
      assert.equal(calls.length, 0, 'cached access cannot start detail or guestlist reads while navigation access is checking');
      view.rerender(strict({ accessChecking: false, refreshKey: 2 }));
      await screen.findByRole('heading', { name: 'Event performance' });
      await screen.findByRole('heading', { name: 'Your guestlist starts here' });
      assert.equal(calls.filter(call => call.path.includes('/guestlist-page')).length, 1);
      assert.equal(calls.filter(call => call.path.endsWith(eventId)).length, 1);
      assert.ok(calls.every(call => !call.signal.aborted), 'StrictMode never starts its discarded reads');
      const stats = dom.window.document.getElementById('my-event-stats-heading');
      const guestlist = dom.window.document.getElementById('my-event-guestlist-heading');
      view.rerender(strict({ accessChecking: true, refreshKey: 2 }));
      view.rerender(strict({ accessChecking: false, refreshKey: 2 }));
      await act(async () => {});
      assert.equal(calls.length, 2, 'an unsuccessful background access check does not reread unchanged detail');
      assert.equal(dom.window.document.getElementById('my-event-stats-heading'), stats);
      assert.equal(dom.window.document.getElementById('my-event-guestlist-heading'), guestlist);
      view.rerender(strict({ accessChecking: false, refreshKey: 3 }));
      await waitFor(() => assert.equal(calls.length, 3));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh event details' }).disabled, false));
      assert.equal(dom.window.document.getElementById('my-event-guestlist-heading'), guestlist);
      await user.click(screen.getByRole('button', { name: 'Refresh event details' }));
      await waitFor(() => assert.equal(calls.length, 4));
      assert.equal(calls.filter(call => call.path.includes('/guestlist-page')).length, 1, 'same-scope totals refresh keeps the guestlist mounted');
      reset();
    });

    await t.test('account changes abort pending detail and reject late results', async () => {
      let oldSignal, releaseOld;
      globalThis.fetch = async (path, options) => {
        if (options.headers.Authorization === 'Bearer first-account') return new Promise(resolve => { oldSignal = options.signal; releaseOld = () => resolve(response(detail)); });
        return response(String(path).includes('/guestlist-page') ? guestPage : { ...detail, event: { ...detail.event, title: 'Second account event' } });
      };
      view = render(strict({ session: { accessToken: 'first-account' } }), { container: dom.window.document.getElementById('root') });
      await waitFor(() => assert.equal(typeof releaseOld, 'function'));
      view.rerender(strict({ session: { accessToken: 'second-account' } }));
      await screen.findByRole('heading', { name: 'Second account event' });
      assert.equal(oldSignal.aborted, true);
      await act(async () => releaseOld());
      assert.equal(screen.queryByRole('heading', { name: 'Scoped event' }), null);
      reset();
    });
  } finally {
    view?.unmount(); await vite?.close(); globalThis.fetch = previousFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
