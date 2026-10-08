import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../../..', import.meta.url));

// Transform the real components without opening a Vite server or writing dist.
async function loadComponents() {
  const result = await build({
    stdin: { contents: `export { BookingMessages } from './apps/shared/BookingMessages.jsx';
      export { SupportMessages } from './apps/shared/SupportMessages.jsx';
      export { Notifications } from './apps/business/src/components/Notifications.jsx';
      export { default as BusinessApp } from './apps/business/src/App.jsx';
      export { useWorkspaceNavigation } from './apps/business/src/hooks/useWorkspaceNavigation.js';`,
      resolveDir: repository, sourcefile: 'inbox-test-entry.jsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    jsx: 'automatic', loader: { '.css': 'empty', '.png': 'dataurl' }, alias: { '@': resolve(repository, 'apps/business/src') },
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test('message and notification inboxes refresh on navigation and explicit actions while idle browsers stay quiet', async t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, HTMLFormElement: dom.window.HTMLFormElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const React = await import('react');
  const { render, screen, waitFor, act, cleanup, within } = await import('@testing-library/react');
  const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
  const { BookingMessages, SupportMessages, Notifications, BusinessApp, useWorkspaceNavigation } = await loadComponents();
  const Button = ({ variant, size, ...props }) => React.createElement('button', props);
  const Panel = ({ children }) => React.createElement('div', null, children);
  const ui = { Button, Dialog: ({ open, children }) => open ? React.createElement('div', { role: 'dialog' }, children) : null,
    DialogContent: Panel, DialogHeader: Panel, DialogTitle: Panel, DialogDescription: Panel };
  const session = { accessToken: 'inbox-fixture-token', user: { id: 'inbox-fixture-user', displayName: 'Fixture User' } };
  const flush = () => act(async () => { await Promise.resolve(); });
  const intervals = new Map(), originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
    if (delay < 10000) return originalSetInterval(callback, delay, ...args);
    const id = Symbol('inbox interval'); intervals.set(id, { callback: () => callback(...args), delay }); return id;
  });
  t.mock.method(globalThis, 'clearInterval', id => { if (!intervals.delete(id)) originalClearInterval(id); });
  async function quiet(calls, include = () => true) {
    const before = calls.filter(include).length;
    await act(async () => {
      for (const { callback, delay } of [...intervals.values()]) for (let elapsed = delay; elapsed <= 90000; elapsed += delay) callback();
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: true });
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      dom.window.dispatchEvent(new dom.window.Event('focus'));
    });
    assert.equal(calls.filter(include).length, before, 'idle time, focus and visibility must not fetch an inbox');
  }
  async function switchBeforeDeferredRead(Component, extraProps, expectedPaths) {
    const starts = [];
    let release, renderedReplacement = false, released = false;
    const pending = new Promise(resolve => { release = resolve; });
    function PendingAccount({ blocked }) {
      if (blocked && !released) { renderedReplacement = true; throw pending; }
      return null;
    }
    const tree = (token, blocked) => React.createElement(React.Suspense, { fallback: 'Switching account' },
      React.createElement(Component, { ...extraProps, session: { ...session, accessToken: token },
        request: async path => { starts.push({ path, token }); return { items: [], total: 0, unreadCount: 0 }; } }),
      React.createElement(PendingAccount, { blocked }));
    const view = render(tree('before-switch-token', false));
    // Render the next identity in this same task, before the initial read's
    // microtask. Suspension holds passive cleanup so the identity preflight,
    // rather than a committed-effect abort, must prevent the old read starting.
    act(() => { React.startTransition(() => view.rerender(tree('after-switch-token', true))); });
    assert.equal(renderedReplacement, true, 'the next identity rendered before the deferred request');
    await flush();
    assert.deepEqual(starts, [], 'an uncommitted account switch must not start the former identity read through the new request ref');
    await act(async () => { released = true; release(); });
    assert.deepEqual(starts.map(row => row.path), expectedPaths);
    assert.ok(starts.every(row => row.token === 'after-switch-token'));
    view.unmount(); cleanup();
  }
  try {
    t.afterEach(() => cleanup());
    await t.test('Business organizer and support navigation, retries, replies and stable props request only the selected data', async () => {
      await switchBeforeDeferredRead(BookingMessages, { side: 'business', ui }, ['/business/messages?page=1&pageSize=20', '/support/messages?page=1&pageSize=1']);
      const calls = [], thread = { id: 'organizer-thread', eventTitle: 'Fixture night', customerName: 'Fixture customer', unread: true };
      let fail = false, release;
      const detail = { thread, messages: { items: [{ id: 'organizer-message', senderName: 'Customer', body: 'Question from customer', kind: 'question' }], hasMore: false }, canReply: true };
      const request = async (path, options = {}) => {
        calls.push({ path, ...options });
        if (path.endsWith('/replies')) return new Promise(resolve => { release = () => resolve(detail); });
        if (path.endsWith('/read')) return {};
        if (path.includes('/organizer-thread?')) return detail;
        if (path.startsWith('/support/messages?')) return { items: [], total: 0, unreadCount: 0 };
        if (fail) throw new Error('Inbox connection interrupted');
        return { items: [thread], total: 21, unreadCount: 1, hasMore: path.includes('?page=1&') };
      };
      let props = { session, side: 'business', request, ui, refreshKey: 0 };
      const view = render(React.createElement(React.StrictMode, null, React.createElement(BookingMessages, props)));
      await screen.findByRole('button', { name: 'Messages, 1 unread' });
      assert.equal(calls.filter(call => call.path === '/business/messages?page=1&pageSize=20').length, 1, 'StrictMode must not start duplicate mount reads');
      await quiet(calls);
      await user.click(screen.getByRole('button', { name: 'Messages, 1 unread' }));
      await screen.findByRole('button', { name: /Fixture night/ });
      const organizerLists = () => calls.filter(call => call.path === '/business/messages?page=1&pageSize=20').length;
      assert.equal(organizerLists(), 2, 'opening the inbox refreshes it once');
      await user.click(screen.getByRole('button', { name: 'Next conversations' }));
      await screen.findByText('Page 2'); await flush();
      const secondPages = () => calls.filter(call => call.path === '/business/messages?page=2&pageSize=20').length;
      assert.equal(secondPages(), 1);
      props = { ...props, session: { ...session, user: { ...session.user } }, request: (...args) => request(...args), onOpened() {} };
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(BookingMessages, props)));
      await flush(); assert.equal(organizerLists(), 2, 'new session/callback objects with the same token do not restart reads');
      assert.equal(secondPages(), 1);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(BookingMessages, { ...props, refreshKey: 1 })));
      await flush();
      await waitFor(() => assert.equal(organizerLists(), 3)); await quiet(calls);
      assert.ok(screen.getByText('Page 1')); assert.equal(secondPages(), 1, 'navigation resets page two without rereading its old page');
      fail = true; await user.click(screen.getByRole('button', { name: 'Reload messages' }));
      await screen.findByRole('alert'); fail = false;
      await user.click(screen.getByRole('button', { name: 'Refresh messages' }));
      await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
      await user.click(screen.getByRole('button', { name: /Fixture night/ }));
      await screen.findByText('Question from customer');
      assert.equal(calls.filter(call => call.path.includes('/organizer-thread?')).length, 1);
      await quiet(calls);
      await user.type(screen.getByLabelText('Your message'), 'Organizer reply');
      await user.click(screen.getByRole('button', { name: 'Send message' }));
      await waitFor(() => assert.ok(release));
      const pending = calls.at(-1); assert.equal(pending.body.body, 'Organizer reply');
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(BookingMessages, { ...props, session: { accessToken: 'replacement-token', user: { id: 'replacement-user' } } })));
      assert.equal(screen.queryByRole('dialog'), null); assert.equal(pending.signal.aborted, true);
      await act(async () => release()); await flush();
      assert.equal(screen.queryByText('Question from customer'), null, 'the former account reply cannot reopen its conversation');
      cleanup();
    });

    await t.test('Admin support stays quiet while inactive and retries, navigates, and refreshes after a reply', async () => {
      await switchBeforeDeferredRead(SupportMessages, { admin: true, ui: { Button } }, ['/admin/support/messages?page=1&pageSize=20']);
      const calls = [], thread = { id: 'support-thread', title: 'Support question', status: 'open', category: 'other' };
      const detail = { thread, messages: { items: [{ id: 'support-message', senderName: 'Requester', body: 'Support question body' }], hasMore: false }, canReply: true };
      let fail = false;
      const request = async (path, options = {}) => {
        calls.push({ path, ...options });
        if (path.endsWith('/read')) return {};
        if (path.endsWith('/replies')) return detail;
        if (path.includes('/support-thread?')) return detail;
        if (fail) throw new Error('Support connection interrupted');
        return { items: [thread], total: 1, unreadCount: 1 };
      };
      const props = { session, admin: true, request, ui: { Button }, active: false };
      const view = render(React.createElement(React.StrictMode, null, React.createElement(SupportMessages, props)));
      await flush(); await quiet(calls); assert.equal(calls.length, 0);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(SupportMessages, { ...props, active: true })));
      await screen.findByRole('button', { name: /Support question/ });
      assert.equal(calls.length, 1); await quiet(calls);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(SupportMessages, { ...props, active: true, session: { ...session }, request: (...args) => request(...args), onUnreadChange() {} })));
      await flush(); assert.equal(calls.length, 1);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(SupportMessages, { ...props, active: true, refreshKey: 1 })));
      await waitFor(() => assert.equal(calls.length, 2));
      fail = true; await user.click(screen.getByRole('button', { name: 'Reload support messages' })); await screen.findByRole('alert');
      fail = false; await user.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByRole('button', { name: /Support question/ });
      await user.click(screen.getByRole('button', { name: /Support question/ })); await screen.findByText('Support question body');
      await quiet(calls);
      const before = calls.filter(call => call.path.includes('/support-thread?')).length;
      await user.type(screen.getByLabelText('Your reply'), 'Private support reply'); await user.click(screen.getByRole('button', { name: 'Send reply' }));
      await screen.findByText('Reply sent privately to the requester.');
      await waitFor(() => assert.equal(calls.filter(call => call.path.includes('/support-thread?')).length, before + 1));
      assert.equal(calls.filter(call => call.path.endsWith('/replies')).length, 1); assert.equal(calls.at(-1).path, '/admin/support/messages/support-thread/read');
      cleanup();
    });

    await t.test('Business notifications use navigation, explicit reload and mutations, and cancel stale account navigation', async () => {
      await switchBeforeDeferredRead(Notifications, {}, ['/notifications?page=1&pageSize=20']);
      const calls = [], navigation = []; let fail = false, release;
      const item = { id: 'notification', title: 'Fixture notification', message: 'Booking update', createdAt: '2026-10-01', eventId: 'fixture-event', readAt: null };
      let items = [item];
      const request = async (path, identity, options = {}) => {
        calls.push({ path, token: identity.accessToken, ...options });
        if (path.endsWith('/read')) return new Promise(resolve => { release = () => resolve({}); });
        if (options.method === 'DELETE') { items = []; return {}; }
        if (fail) throw new Error('Notifications connection interrupted');
        return { items, total: items.length ? 21 : 0, pageSize: 20, hasMore: Boolean(items.length && path.includes('?page=1&')), unreadCount: items.filter(row => !row.readAt).length };
      };
      const props = { session, request, onNavigate: (...args) => navigation.push(args) };
      const view = render(React.createElement(React.StrictMode, null, React.createElement(Notifications, props)));
      await screen.findByRole('button', { name: 'Notifications, 1 unread' });
      assert.equal(calls.length, 1); await quiet(calls);
      await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' })); await screen.findByText('Fixture notification');
      assert.equal(calls.length, 2);
      await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
      await flush(); assert.equal(calls.at(-1).path, '/notifications?page=2&pageSize=20'); assert.equal(calls.length, 3);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(Notifications, { ...props, session: { ...session }, request: (...args) => request(...args), onNavigate() {} })));
      await flush(); assert.equal(calls.length, 3);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(Notifications, { ...props, refreshKey: 1 })));
      await flush();
      await waitFor(() => assert.equal(calls.length, 4)); await quiet(calls);
      assert.equal(calls.at(-1).path, '/notifications?page=1&pageSize=20');
      assert.equal(calls.filter(call => call.path === '/notifications?page=2&pageSize=20').length, 1, 'navigation starts exactly one fresh first page');
      fail = true; await user.click(screen.getByRole('button', { name: 'Reload notifications' })); await screen.findByRole('alert');
      fail = false; await user.click(screen.getByRole('button', { name: 'Try again' })); await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
      await user.click(screen.getByRole('button', { name: 'Dismiss' })); await screen.findByText('No notifications on this page.');
      assert.equal(calls.filter(call => call.method === 'DELETE').length, 1);
      items = [item]; await user.click(screen.getByRole('button', { name: 'Reload notifications' })); await screen.findByText('Fixture notification');
      await user.click(screen.getByRole('button', { name: /Fixture notification/ })); await waitFor(() => assert.ok(release));
      const pending = calls.at(-1);
      view.rerender(React.createElement(React.StrictMode, null, React.createElement(Notifications, { ...props, session: { accessToken: 'replacement-token', user: { id: 'replacement-user' } } })));
      assert.equal(pending.signal.aborted, true); assert.equal(screen.queryByRole('dialog'), null);
      await act(async () => release()); assert.deepEqual(navigation, [], 'a former account read must not navigate the replacement account');
      cleanup();
    });

    await t.test('Business route navigation and Back drive one inbox refresh each', async () => {
      const calls = [];
      function Shell() {
        const navigation = useWorkspaceNavigation();
        const request = async path => { calls.push(path); return { items: [], total: 0, unreadCount: 0 }; };
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => navigation.navigate('events') }, 'Navigate to events'),
          React.createElement('button', { onClick: () => navigation.navigate('overview') }, 'Navigate to overview'),
          React.createElement(BookingMessages, { session: { ...session }, side: 'business', request, ui, refreshKey: navigation.eventNavigationRevision }));
      }
      render(React.createElement(React.StrictMode, null, React.createElement(Shell)));
      await flush();
      const lists = () => calls.filter(path => path === '/business/messages?page=1&pageSize=20').length;
      await waitFor(() => assert.equal(lists(), 1));
      await user.click(screen.getByRole('button', { name: 'Navigate to events' })); await waitFor(() => assert.equal(lists(), 2));
      await user.click(screen.getByRole('button', { name: 'Navigate to overview' })); await waitFor(() => assert.equal(lists(), 3));
      await act(async () => { dom.window.history.replaceState(null, '', '/app?section=events'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
      await waitFor(() => assert.equal(lists(), 4)); await quiet(calls); cleanup();
    });

    await t.test('the actual Business shell refreshes inboxes on page navigation and keeps its bootstrap quiet on focus', async () => {
      const calls = [], priorFetch = globalThis.fetch;
      dom.window.history.replaceState(null, '', '/app?section=events');
      dom.window.sessionStorage.setItem('nitewide.business.session', JSON.stringify({ ...session, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
      globalThis.fetch = async (path, options = {}) => {
        calls.push({ path, ...options });
        const data = path === '/api/business/bootstrap' ? { organizations: [], venues: [], events: [], setupProgress: [], capabilities: {}, scope: { canCreateIndependent: true } }
          : path === '/api/business/reports/exports' ? [] : { items: [], total: 0, unreadCount: 0, page: 1, pageSize: 20, hasMore: false };
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      try {
        render(React.createElement(BusinessApp));
        await screen.findByRole('heading', { name: 'Every event. The whole picture.' }); await flush();
        const inboxPaths = ['/api/business/messages?page=1&pageSize=20', '/api/support/messages?page=1&pageSize=1', '/api/notifications?page=1&pageSize=20'];
        const count = path => calls.filter(call => call.path === path).length;
        for (const path of inboxPaths) assert.equal(count(path), 1, path);
        const include = call => inboxPaths.includes(call.path) || call.path === '/api/business/bootstrap';
        await quiet(calls, include);
        assert.equal(count('/api/business/bootstrap'), 1);
        const navigation = within(screen.getByRole('navigation', { name: 'Main navigation' }));
        await user.click(navigation.getByRole('button', { name: 'Overview', exact: true }));
        await screen.findByText('No open actions right now.'); await flush();
        for (const path of inboxPaths) assert.equal(count(path), 2, path);
        assert.equal(count('/api/business/bootstrap'), 2, 'return to Overview refreshes saved workspace milestones');
        await user.click(navigation.getByRole('button', { name: 'Events', exact: true }));
        await screen.findByRole('heading', { name: 'Every event. The whole picture.' }); await flush();
        for (const path of inboxPaths) assert.equal(count(path), 3, path);
        await act(async () => { dom.window.history.replaceState(null, '', '/app'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
        await screen.findByText('No open actions right now.'); await flush();
        for (const path of inboxPaths) assert.equal(count(path), 4, path);
        await quiet(calls, include);
      } finally { cleanup(); globalThis.fetch = priorFetch; dom.window.sessionStorage.removeItem('nitewide.business.session'); }
    });
  } finally {
    cleanup(); t.mock.restoreAll();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
