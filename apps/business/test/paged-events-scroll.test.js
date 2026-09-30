import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('PagedEvents skips fresh restores, accepts zero, cancels pending restore, and keeps pager scroll', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app?section=events', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLSelectElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const rafs = new Map();
  const canceled = [];
  let nextFrame = 0;
  const requestFrame = (callback) => { const id = ++nextFrame; rafs.set(id, callback); return id; };
  const cancelFrame = (id) => { canceled.push(id); rafs.delete(id); };
  const flushFrames = () => { const pending = [...rafs.values()]; rafs.clear(); pending.forEach((callback) => callback(0)); };
  const scrollCalls = [];
  const cardScrollCalls = [];
  dom.window.scrollTo = (...args) => scrollCalls.push(args);
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) { cardScrollCalls.push({ element: this, options }); };
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame, IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const priorFetch = globalThis.fetch;
  const event = { id: 'event-a', title: 'Neon Night', startsAt: '2099-06-20T21:00:00.000Z',
    canManage: false, offerings: [], location: { name: 'The Venue', timezone: 'UTC' } };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), dom.window.location.href);
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 10);
    const all = [event, ...Array.from({ length: 10 }, (_, index) => ({ ...event, id: `event-${index + 2}`, title: `Event ${index + 2}` }))];
    return new Response(JSON.stringify({ data: { items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length, page, pageSize, hasMore: page * pageSize < all.length,
      counts: { upcoming: all.length, past: 0, draft: 0 } } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let vite;
  let mounted;
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: resolve(root, 'vite.config.js'), root, logLevel: 'silent',
      server: { middlewareMode: true }, appType: 'custom' });
    const { PagedEvents } = await vite.ssrLoadModule('/src/components/PagedEvents.jsx');
    const React = await import('react');
    const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { session: { accessToken: 'fixture' }, organizationIds: [], venueIds: [], onUnauthorized() {} };
    const mount = () => {
      mounted = render(React.createElement(PagedEvents, props), { container: dom.window.document.getElementById('root') });
      return mounted;
    };

    mount();
    await screen.findByRole('button', { name: 'Open Neon Night' });
    assert.deepEqual(scrollCalls, [], 'fresh Events mount does not restore an absent offset');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /11–11 of 11 events/));
    await waitFor(() => assert.ok(rafs.size > 0, 'pager schedules a collection scroll'));
    flushFrames();
    assert.equal(cardScrollCalls.at(-1)?.element.className, 'panel event-library');

    mounted.unmount();
    cleanup();
    dom.window.history.replaceState({ eventsScrollY: 0 }, '', '/app?section=events');
    scrollCalls.length = 0;
    mount();
    await screen.findByRole('button', { name: 'Open Neon Night' });
    await waitFor(() => assert.ok(rafs.size > 0, 'saved zero offset schedules a restoration'));
    flushFrames();
    assert.deepEqual(scrollCalls.at(-1), [{ top: 0, behavior: 'instant' }]);

    mounted.unmount();
    cleanup();
    dom.window.history.replaceState({ eventsScrollY: 0 }, '', '/app?section=events');
    mount();
    await screen.findByRole('button', { name: 'Open Neon Night' });
    await waitFor(() => assert.ok(rafs.size > 0, 'restore frame is pending before unmount'));
    const frame = [...rafs.keys()][0];
    mounted.unmount();
    mounted = null;
    assert.ok(canceled.includes(frame), 'unmount cancels the queued restoration');
    cleanup();
  } finally {
    try { mounted?.unmount(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (vite) await vite.close();
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
