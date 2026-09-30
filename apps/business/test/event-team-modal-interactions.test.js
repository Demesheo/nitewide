import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('event member controls stay gated until Edit member is selected', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = dom.window.ResizeObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  let vite;
  let unmount;
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { EventPeople } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const person = { id: 'person-1', userId: 'user-1', name: 'Riley Promoter', email: 'riley@fixture.test', role: 'Promoter', status: 'active', commissionBps: 500, salesCents: 12500, commissionCents: 625, orders: 3, customers: 3, guestlistPlaces: 2, approvedGuestlistPlaces: 1 };
    const view = render(React.createElement(EventPeople, {
      data: { event: { id: 'event-1', title: 'Fixture Night', status: 'published', canEdit: true, canManage: true }, scope: 'event', people: [person], candidates: [person] },
      session: { accessToken: 'fixture-token' }, onSaved() {}, onUnauthorized() {},
      remote: { search: '', onSearch() {}, sort: 'salesCents', descending: true, onSort() {}, roles: [], onRoles() {}, roleOptions: [{ id: 'Promoter', label: 'Promoters' }] },
    }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await user.click(await screen.findByRole('button', { name: /Riley Promoter/ }));
    await screen.findByRole('heading', { name: 'Riley Promoter' });
    assert.ok(screen.getByRole('button', { name: 'Edit member' }));
    assert.equal(screen.queryByRole('slider', { name: 'Event commission percentage' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Remove from event' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Save commission' }), null);

    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    assert.ok(screen.getByRole('slider', { name: 'Event commission percentage' }));
    assert.ok(screen.getByRole('button', { name: 'Remove from event' }));
    assert.ok(screen.getByRole('button', { name: 'Save commission' }));
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
