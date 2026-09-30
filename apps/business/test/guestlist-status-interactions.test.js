import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Guest Experience status selection sends repeated status query values', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const priorFetch = globalThis.fetch;
  const listRequests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), dom.window.location.href);
    if (url.pathname.endsWith('/guestlist-page')) listRequests.push(url);
    return new Response(JSON.stringify({ data: { items: [], total: 0, page: Number(url.searchParams.get('page') || 1), pageSize: 10, hasMore: false } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { Guestlists } = await vite.ssrLoadModule('/src/components/Guestlists.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const view = render(React.createElement(Guestlists, {
      event: { id: 'event-fixture', title: 'Fixture Night', startsAt: '2099-10-01T22:00:00Z', canManage: false, canEdit: false },
      session: { accessToken: 'fixture-token' }, expire() {},
    }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await waitFor(() => assert.ok(listRequests.length));
    await user.click(screen.getByRole('button', { name: /Request status/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Approved' }));
    await waitFor(() => assert.ok(listRequests.some((url) => url.searchParams.getAll('statuses').join(',') === 'pending,confirmed')));
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
