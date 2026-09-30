import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

test('manager can reactivate an inactive event assignment through the event team save flow', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = dom.window.ResizeObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const priorFetch = globalThis.fetch;
  const requests = [];
  let vite;
  let unmount;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { EventPeople } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const member = { id: 'event-affiliate-1', userId: 'manager-1', name: 'Morgan Manager', email: 'morgan@fixture.test', role: 'Manager', status: 'inactive', code: 'NW-fixture', commissionBps: 1000, guestlistAllocation: 10, salesCents: 12000, commissionCents: 1200, orders: 1, customers: 1, guestlistPlaces: 3, approvedGuestlistPlaces: 3 };
    const view = render(React.createElement(EventPeople, {
      data: { event: { id: 'event-1', title: 'Fixture Night', status: 'published', canEdit: true, canManage: true }, scope: 'event', people: [member], candidates: [member] },
      session: { accessToken: 'fixture-token' }, onSaved() {}, onUnauthorized() {},
    }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await user.click(await screen.findByRole('button', { name: /Morgan Manager/ }));
    await screen.findByRole('heading', { name: 'Morgan Manager' });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    const save = requests.find((entry) => entry.url.endsWith('/business/events/event-1/people') && entry.method === 'PUT');
    assert.ok(save, 'the member dialog submits through the event assignment save endpoint');
    assert.deepEqual(save.body, { userId: 'manager-1', commissionBps: 1000, status: 'active' }, 'saving an inactive assignment explicitly requests reactivation with the current terms');
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

test('referral link retry recovers from an actionable error and revisions refetch link plus pools', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = dom.window.ResizeObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const priorFetch = globalThis.fetch;
  const calls = { link: 0, pools: 0 };
  let vite;
  let unmount;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/business/events/event-1/referral-link')) {
      calls.link += 1;
      if (calls.link === 1) return new Response(JSON.stringify({ error: { message: 'Referral service is temporarily unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ data: { code: `NW-${calls.link}` } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (value.endsWith('/business/events/event-1/guestlist-invite-pools')) {
      calls.pools += 1;
      const data = calls.pools === 1
        ? { open: true, direct: false, own: [] }
        : { open: true, direct: calls.pools >= 3, own: [{ id: 'event-affiliate-1', guestlistAllocation: 10 }] };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fixture request: ${value}`);
  };
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { ReferralLink } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, waitFor } = await import('@testing-library/react');
    const { within } = await import('@testing-library/dom');
    const ui = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { event: { id: 'event-1', status: 'published' }, session: { accessToken: 'fixture-token' }, onUnauthorized() {} };
    const view = render(React.createElement(ReferralLink, { ...props, revision: 0 }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    await waitFor(() => { assert.equal(calls.link, 1); });
    await waitFor(() => { assert.ok(ui.queryByRole('alert'), dom.window.document.body.innerHTML); });
    const alert = ui.getByRole('alert');
    assert.match(alert.textContent, /Referral service is temporarily unavailable/);
    await user.click(ui.getByRole('button', { name: 'Retry' }));
    await ui.findByRole('button', { name: 'Copy link' });
    await waitFor(() => { assert.equal(calls.link, 2); assert.equal(calls.pools, 2); });
    assert.equal(ui.queryByRole('alert'), null, 'the actionable error clears after recovery');
    await user.click(ui.getByRole('button', { name: 'Invite guest' }));
    await ui.findByRole('heading', { name: 'Invite to guestlist' });
    await ui.findByRole('option', { name: 'Venue direct guestlist' });
    assert.equal(calls.pools, 3, 'opening Invite reloads the latest eligible pool options');
    await user.keyboard('{Escape}');

    view.rerender(React.createElement(ReferralLink, { ...props, revision: 1 }));
    await waitFor(() => { assert.equal(calls.link, 3); assert.equal(calls.pools, 4); });
    await ui.findByRole('button', { name: 'Copy link' });
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

test('referral link keeps the revision, actionable error, and retry wiring visible in the source', () => {
  const source = readFileSync(new URL('../src/components/EventDetail.jsx', import.meta.url), 'utf8');
  const referralLink = source.slice(source.indexOf('export function ReferralLink'), source.indexOf('\nfunction Metric'));
  assert.match(referralLink, /api\(`\/business\/events\/\$\{event\.id\}\/referral-link`, session\)/);
  assert.match(referralLink, /\[event\.id, session, revision, linkRetry\]/);
  assert.match(referralLink, /error\.status === 401\) onUnauthorized\(\); else setLinkError\(error\.message\)/);
  assert.match(referralLink, /onRetryReferral=\{\(\) => setLinkRetry\(\(value\) => value \+ 1\)\}/);
  const shareCard = readFileSync(new URL('../src/components/ShareEventCard.jsx', import.meta.url), 'utf8');
  assert.match(shareCard, /role="alert">Your referral link could not be loaded:/);
  assert.match(shareCard, /onClick=\{onRetryReferral\}>Retry/);
});
