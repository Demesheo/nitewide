import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('customer header reads follow navigation and explicit inbox actions without background polling', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLFormElement: dom.window.HTMLFormElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const previousFetch = globalThis.fetch;
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { Notifications } = await vite.ssrLoadModule('/src/components/notifications.jsx');
    const { Messages, ContactNitewide } = await vite.ssrLoadModule('/src/components/messages.jsx');
    const { useConnections } = await vite.ssrLoadModule('/src/lib/use-connections.js');
    const { BookingMessages } = await vite.ssrLoadModule('/../shared/BookingMessages.jsx');
    const React = await import('react');
    const { render, screen, waitFor, act } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const session = { accessToken: 'header-account', user: { id: 'header-user' } };
    const response = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    const calls = [], pollingIntervals = [];
    const nativeInterval = globalThis.setInterval;
    t.mock.method(globalThis, 'setInterval', (callback, duration, ...args) => {
      if (duration === 30000) pollingIntervals.push(callback);
      return nativeInterval(callback, duration, ...args);
    });
    const organizerInbox = '/api/customer/messages?page=1&pageSize=20';
    const supportCount = '/api/support/messages?page=1&pageSize=1';
    const notifications = '/api/notifications?page=1&pageSize=20';
    const connections = '/api/customer/connections/summary';
    const supportInbox = '/api/support/messages?page=1&pageSize=20';
    const supportDetail = { thread: { id: 'support-thread', title: 'Account help', category: 'account_access', status: 'open' }, messages: { items: [{ id: 'reply', senderName: 'Nitewide', body: 'Your account reply', createdAt: '2026-10-01' }], hasMore: false }, canReply: true };
    globalThis.fetch = async (path, options = {}) => {
      calls.push({ path, options });
      if (path === connections) return response({ eligible: true });
      if (path === notifications) return response({ items: [], unreadCount: 0, hasMore: false });
      if (path === organizerInbox) return response({ items: [], unreadCount: 1, total: 0 });
      if (path === supportCount) return response({ items: [], unreadCount: 2 });
      if (path === supportInbox) return response({ items: [{ id: 'support-thread', title: 'Account help', status: 'open', lastMessagePreview: 'Your account reply' }], unreadCount: 2, total: 1 });
      if (path.startsWith('/api/support/messages/support-thread?')) return response(supportDetail);
      if (path.endsWith('/support-thread/read')) return response({});
      throw new Error(`Unexpected request: ${path}`);
    };
    const count = path => calls.filter(call => call.path === path).length;
    async function passiveEvents() {
      await act(async () => {
        for (let i = 0; i < 3; i += 1) {
          dom.window.dispatchEvent(new dom.window.Event('focus'));
          dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        }
        for (const callback of pollingIntervals) callback();
      });
    }
    function Header({ session, refreshKey }) {
      const summary = useConnections(session, refreshKey);
      return React.createElement(React.Fragment, null,
        React.createElement('span', null, summary?.eligible ? 'Connections available' : 'No connections'),
        React.createElement(Notifications, { session, refreshKey, onNotification() {} }),
        React.createElement(Messages, { session, refreshKey }),
        React.createElement(ContactNitewide, { session }));
    }

    await t.test('StrictMode mounts once, ignores focus/visibility/timers, and rereads once per navigation', async () => {
      const tree = refreshKey => React.createElement(React.StrictMode, null, React.createElement(Header, { session, refreshKey }));
      view = render(tree('discover'), { container: dom.window.document.getElementById('root') });
      await screen.findByRole('button', { name: 'Messages, 3 unread' });
      await screen.findByText('Connections available');
      for (const path of [connections, notifications, organizerInbox, supportCount]) assert.equal(count(path), 1, path);
      const before = calls.length;
      await passiveEvents();
      assert.equal(calls.length, before);
      assert.equal(pollingIntervals.length, 0, 'customer inboxes never schedule a polling interval');
      view.rerender(tree('booked'));
      await waitFor(() => { for (const path of [connections, notifications, organizerInbox, supportCount]) assert.equal(count(path), 2, path); });
      view.rerender(tree('booked'));
      await passiveEvents();
      assert.equal(calls.length, before * 2, 'rerenders with the same route do not refresh the header');
      view.unmount(); view = null;
    });

    await t.test('opening an inbox and support conversation still refreshes and marks only displayed messages read', async () => {
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      calls.length = 0;
      view = render(React.createElement(Messages, { session, refreshKey: 'discover' }), { container: dom.window.document.getElementById('root') });
      await screen.findByRole('button', { name: 'Messages, 3 unread' });
      await user.click(screen.getByRole('button', { name: 'Messages, 3 unread' }));
      await screen.findByText(/No conversations yet/);
      await waitFor(() => assert.equal(count(supportCount), 2));
      assert.equal(count(organizerInbox), 2, 'opening requests a fresh organizer inbox');
      await user.click(screen.getByRole('button', { name: /Nitewide support/ }));
      await user.click(await screen.findByRole('button', { name: /Account help/ }));
      await screen.findByText('Your account reply');
      await waitFor(() => assert.equal(count('/api/support/messages/support-thread/read'), 1));
      const read = calls.find(call => call.path.endsWith('/support-thread/read'));
      assert.deepEqual(JSON.parse(read.options.body), { messageId: 'reply' });
      assert.equal(read.options.headers.Authorization, 'Bearer header-account');
      const before = calls.length;
      await passiveEvents();
      assert.equal(calls.length, before);
      assert.equal(pollingIntervals.length, 0, 'the displayed support panel also stays free of polling');
      await user.keyboard('{Escape}');
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      await passiveEvents();
      assert.equal(calls.length, before, 'closing the customer inbox does not fetch it again');
      view.unmount(); view = null;
    });

    await t.test('changing accounts aborts header reads and prevents old replies from starting new-account follow-up requests', async () => {
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      const pending = [], received = [];
      globalThis.fetch = async (path, options) => {
        received.push({ path, options });
        if (path === supportCount) return response({ items: [], unreadCount: 0 });
        return new Promise(resolve => pending.push({ path, signal: options.signal, token: options.headers.Authorization, resolve }));
      };
      view = render(React.createElement(Header, { session, refreshKey: 'discover' }), { container: dom.window.document.getElementById('root') });
      await waitFor(() => assert.equal(pending.length, 3));
      const nextSession = { accessToken: 'new-header-account', user: { id: 'new-header-user' } };
      view.rerender(React.createElement(Header, { session: nextSession, refreshKey: 'discover' }));
      await waitFor(() => assert.equal(pending.length, 6));
      assert.ok(pending.slice(0, 3).every(request => request.signal.aborted));
      await act(async () => {
        for (const request of pending.slice(3)) request.resolve(response(request.path === connections ? { eligible: true } : { items: [], unreadCount: 0, total: 0, hasMore: false }));
      });
      await screen.findByText('Connections available');
      await waitFor(() => assert.equal(received.filter(request => request.path === supportCount).length, 1));
      assert.equal(received.at(-1).options.headers.Authorization, 'Bearer new-header-account');
      const before = received.length;
      await act(async () => {
        for (const request of pending.slice(0, 3)) request.resolve(response(request.path === connections ? { eligible: false } : { items: [], unreadCount: 9, total: 0, hasMore: false }));
      });
      assert.equal(received.length, before, 'the cancelled organizer request never starts a support count with the new token');
      assert.ok(screen.getByRole('button', { name: 'Messages' }));
      assert.ok(screen.getByRole('button', { name: 'Notifications' }));
      assert.ok(screen.getByText('Connections available'));
      view.unmount(); view = null;
    });

    await t.test('shared business messaging retains its existing polling option', async () => {
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      const Button = ({ variant, size, ...props }) => React.createElement('button', props);
      const panel = ({ children }) => React.createElement('div', null, children);
      const ui = { Button, Dialog: ({ children }) => React.createElement('div', null, children), DialogContent: panel, DialogHeader: panel, DialogTitle: panel, DialogDescription: panel };
      const requests = [];
      const request = async path => { requests.push(path); return { items: [], unreadCount: 0, total: 0 }; };
      view = render(React.createElement(BookingMessages, { session, side: 'business', request, ui }), { container: dom.window.document.getElementById('root') });
      await waitFor(() => assert.equal(requests.length, 2));
      assert.equal(pollingIntervals.length, 2, 'organizer and support polling remain enabled by default');
      await act(async () => { for (const callback of pollingIntervals) callback(); });
      await waitFor(() => assert.equal(requests.length, 4));
      view.unmount(); view = null;
    });
  } finally {
    view?.unmount(); await vite?.close(); globalThis.fetch = previousFetch;
    t.mock.restoreAll();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
