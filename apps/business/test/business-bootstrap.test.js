import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('fresh signed-out bootstrap renders sign in without requesting protected business data', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/sign-in', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element,
    Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(new URL(String(input), dom.window.location.href));
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const view = render(React.createElement(App), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    await screen.findByRole('heading', { name: 'Welcome back.' });
    assert.equal(calls.some((url) => url.pathname.endsWith('/business/bootstrap')), false);
  } finally {
    try { unmount?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (vite) await vite.close();
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
