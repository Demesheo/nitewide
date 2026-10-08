import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('cancelled response bodies and invalid notification pages never reach a render updater', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
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
    const { api } = await vite.ssrLoadModule('/src/lib/api.js');
    const { Notifications } = await vite.ssrLoadModule('/src/components/notifications.jsx');
    const React = await import('react');
    const { render, screen, waitFor, act } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const response = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    const page = { items: [{ id: 'notice', title: 'Recovered booking', message: 'Your booking is confirmed.', createdAt: '2026-10-01T12:00:00Z', readAt: null }], unreadCount: 1, hasMore: false };

    await t.test('a body cancelled after successful headers rejects with the original AbortError', async () => {
      const cancelled = new DOMException('Response body was cancelled during navigation', 'AbortError');
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw cancelled; } });
      await assert.rejects(api('/notifications?page=1'), error => error === cancelled);
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Incomplete JSON'); } });
      await assert.rejects(api('/notifications?page=1'), /couldn’t read the response/);
      globalThis.fetch = async () => new Response('{}', { status: 200 });
      await assert.rejects(api('/notifications?page=1'), /couldn’t read the response/);
    });

    await t.test('the active notification panel survives a cancelled body and a malformed refresh, then retries', async () => {
      let calls = 0, cancelBody;
      const errors = [];
      dom.window.addEventListener('error', event => errors.push(event.message));
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return { ok: true, status: 200, json: () => new Promise((resolve, reject) => { cancelBody = reject; }) };
        return response(page);
      };
      const props = { session: { accessToken: 'fixture-token' }, onNotification() {} };
      view = render(React.createElement(Notifications, props), { container: dom.window.document.getElementById('root') });
      await waitFor(() => assert.equal(typeof cancelBody, 'function'));
      await act(async () => cancelBody(new DOMException('Notification response cancelled', 'AbortError')));
      const trigger = screen.getByRole('button', { name: /^Notifications/ });
      await user.click(trigger);
      await screen.findByRole('button', { name: /Recovered booking/ });
      assert.equal(screen.queryByRole('alert'), null);
      assert.equal(trigger.getAttribute('aria-label'), 'Notifications, 1 unread');
      globalThis.fetch = async () => response({});
      view.rerender(React.createElement(Notifications, { ...props, refreshKey: 1 }));
      const alert = await screen.findByRole('alert');
      assert.match(alert.textContent, /couldn’t load notifications/);
      assert.ok(screen.getByRole('button', { name: /Recovered booking/ }), 'a malformed refresh retains the previously loaded notification');
      globalThis.fetch = async () => response(page);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
      assert.deepEqual(errors, []);
      await user.keyboard('{Escape}');
      view.unmount(); view = null;
    });

    await t.test('changing the session aborts an unfinished response and ignores its late body', async () => {
      const pending = [];
      globalThis.fetch = async (path, options) => ({ ok: true, status: 200, json: () => new Promise(resolve => pending.push({ signal: options.signal, resolve })) });
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      const props = { session: { accessToken: 'first-token' }, onNotification() {} };
      view = render(React.createElement(Notifications, props), { container: dom.window.document.getElementById('root') });
      await waitFor(() => assert.equal(pending.length, 1));
      view.rerender(React.createElement(Notifications, { ...props, session: { accessToken: 'second-token' } }));
      await waitFor(() => assert.equal(pending.length, 2));
      assert.equal(pending[0].signal.aborted, true);
      await act(async () => {
        pending[1].resolve({ data: { items: [], unreadCount: 0, hasMore: false } });
        pending[0].resolve({ data: page });
      });
      assert.equal(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label'), 'Notifications');
      view.unmount(); view = null;
    });
  } finally {
    view?.unmount(); await vite?.close(); globalThis.fetch = previousFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
