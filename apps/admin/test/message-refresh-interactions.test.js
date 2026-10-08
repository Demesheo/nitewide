import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);

test('Admin Messages refreshes on shell navigation, reload and replies while idle, focus and hidden tabs remain quiet', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/?section=messages', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, HTMLFormElement: dom.window.HTMLFormElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const session = { accessToken: 'admin-inbox-fixture', roles: ['internal_admin'], user: { id: 'admin-inbox-user', displayName: 'Fixture Support', email: 'support@example.test', isInternalAdmin: true, isActive: true, internalAdminRole: 'support' } };
  dom.window.sessionStorage.setItem('nitewide.admin.session', JSON.stringify(session));
  const calls = [], thread = { id: 'admin-thread', title: 'Private support question', status: 'open', category: 'other' };
  const detail = { thread, messages: { items: [{ id: 'message', senderName: 'Requester', body: 'Private requester body' }], hasMore: false }, canReply: true };
  let fail = false, activeSession = session;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, ...options });
    let data, status = 200;
    if (path === '/api/auth/me') data = { user: activeSession.user, roles: activeSession.roles };
    else if (path.endsWith('/read')) data = {};
    else if (path.endsWith('/replies') || path.includes('/admin-thread?')) data = detail;
    else if (path.startsWith('/api/admin/support/messages?')) {
      if (fail) status = 503;
      data = { items: [thread], total: 1, unreadCount: 1 };
    } else data = { items: [], total: 0, page: 1, pageSize: 10, hasMore: false };
    return new Response(JSON.stringify(status === 200 ? { data } : { error: { message: 'Admin inbox connection interrupted' } }), { status, headers: { 'content-type': 'application/json' } });
  };
  let captured, view;
  const priorRoot = globalThis.__nitewideAdminInboxTestRoot;
  globalThis.__nitewideAdminInboxTestRoot = { render(element) { captured = element; } };
  let cleanup;
  try {
    const result = await build({ entryPoints: [fileURLToPath(new URL('../src/main.jsx', import.meta.url))],
      bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic',
      loader: { '.css': 'empty', '.png': 'dataurl' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
      plugins: [{ name: 'capture-admin-bootstrap', setup(builder) {
        builder.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: 'root', namespace: 'inbox-root' }));
        builder.onLoad({ filter: /.*/, namespace: 'inbox-root' }, () => ({ contents: 'export const createRoot = () => globalThis.__nitewideAdminInboxTestRoot;', loader: 'js' }));
      } }],
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    const React = await import('react');
    const testing = await import('@testing-library/react'); cleanup = testing.cleanup;
    const { render, screen, act, waitFor } = testing;
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const count = size => calls.filter(call => call.path === `/api/admin/support/messages?page=1&pageSize=${size}`).length;
    const flush = () => act(async () => { await Promise.resolve(); });
    const intervals = new Map(), originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
    t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
      if (delay < 10000) return originalSetInterval(callback, delay, ...args);
      const id = Symbol('admin inbox interval'); intervals.set(id, { callback: () => callback(...args), delay }); return id;
    });
    t.mock.method(globalThis, 'clearInterval', id => { if (!intervals.delete(id)) originalClearInterval(id); });
    view = render(React.createElement(React.StrictMode, null, captured), { container: dom.window.document.getElementById('root') });
    await screen.findByRole('button', { name: /Private support question/ }); await flush();
    assert.equal(count(1), 1); assert.equal(count(20), 1, 'mount and StrictMode replay start one request per resource');
    async function quiet() {
      const before = calls.length;
      await act(async () => {
        for (const { callback, delay } of [...intervals.values()]) for (let elapsed = delay; elapsed <= 90000; elapsed += delay) callback();
        dom.window.dispatchEvent(new dom.window.Event('focus'));
        Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: true });
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      });
      assert.equal(calls.length, before);
    }
    await quiet();
    await user.click(screen.getByRole('button', { name: 'Messages, 1 unread' })); await flush();
    assert.equal(count(1), 2); assert.equal(count(20), 2, 'same-page Messages navigation explicitly refreshes');
    await user.click(screen.getByRole('button', { name: 'Overview', exact: true }));
    await screen.findByText('No issues need attention.'); await flush(); assert.equal(count(1), 3);
    await act(async () => { dom.window.history.replaceState(null, '', '?section=messages'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
    await screen.findByRole('button', { name: /Private support question/ }); await flush();
    assert.equal(count(1), 4); assert.equal(count(20), 3, 'Back navigation reloads badge and the reopened workspace once');
    fail = true; await user.click(screen.getByRole('button', { name: 'Reload support messages' })); await screen.findByRole('alert');
    fail = false; await user.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByRole('button', { name: /Private support question/ });
    await user.click(screen.getByRole('button', { name: /Private support question/ })); await screen.findByText('Private requester body');
    const reads = () => calls.filter(call => call.path.includes('/admin-thread?')).length;
    assert.equal(reads(), 1); await quiet();
    await user.type(screen.getByLabelText('Your reply'), 'Reply for this requester'); await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByText('Reply sent privately to the requester.'); await flush();
    assert.equal(reads(), 2); assert.equal(calls.filter(call => call.path.endsWith('/replies')).length, 1);
    await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
    view.unmount();
    activeSession = { ...session, accessToken: 'admin-without-message-permission', user: { ...session.user, isInternalAdmin: false } };
    dom.window.sessionStorage.setItem('nitewide.admin.session', JSON.stringify(activeSession));
    const before = calls.filter(call => call.path.includes('/admin/support/messages')).length;
    const deniedRoot = dom.window.document.createElement('div'); dom.window.document.body.append(deniedRoot);
    view = render(React.createElement(captured.type), { container: deniedRoot });
    await screen.findByRole('alert'); await flush();
    assert.equal(calls.filter(call => call.path.includes('/admin/support/messages')).length, before, 'roles without support.view never request the private inbox or badge');
  } finally {
    view?.unmount(); cleanup?.(); t.mock.restoreAll(); globalThis.fetch = priorFetch;
    if (priorRoot === undefined) delete globalThis.__nitewideAdminInboxTestRoot; else globalThis.__nitewideAdminInboxTestRoot = priorRoot;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
