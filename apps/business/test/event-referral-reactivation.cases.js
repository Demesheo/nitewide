import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createEventPeopleTestServer } from './helpers/event-people-runtime.js';

test('manager can reactivate an inactive event assignment through the event team save flow', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
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
  let cleanupRoots;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    vite = await createEventPeopleTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { EventPeople } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, within, cleanup } = await import('@testing-library/react');
    cleanupRoots = cleanup;
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const member = { id: 'event-affiliate-1', userId: 'manager-1', name: 'Morgan Manager', email: 'morgan@fixture.test', role: 'Manager', status: 'inactive', code: 'NW-fixture', commissionBps: 1000, guestlistAllocation: 10, salesCents: 12000, commissionCents: 1200, orders: 1, customers: 1, guestlistPlaces: 3, approvedGuestlistPlaces: 3 };
    const view = render(React.createElement(EventPeople, {
      data: { event: { id: 'event-1', title: 'Fixture Night', status: 'published', canEdit: true, canManage: true }, scope: 'event', people: [member], candidates: [member] },
      session: { accessToken: 'fixture-token' }, onSaved() {}, onUnauthorized() {},
    }), { container: dom.window.document.getElementById('root') });

    await user.click(await screen.findByRole('button', { name: /Morgan Manager/ }));
    await screen.findByRole('heading', { name: 'Morgan Manager' });
    assert.ok(within(screen.getByRole('dialog')).getByText('$12.00'), 'historical earned commissions remain visible');
    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    assert.equal(screen.getByRole('slider', { name: 'Event commission percentage' }).getAttribute('aria-valuenow'), '0');
    assert.equal(screen.getByRole('slider', { name: 'Event commission percentage' }).hasAttribute('data-disabled'), true);
    assert.ok(screen.getByText(/Locked at 0% until this person completes their individual Stripe onboarding/));
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    const save = requests.find((entry) => entry.url.endsWith('/business/events/event-1/people') && entry.method === 'PUT');
    assert.ok(save, 'the member dialog submits through the event assignment save endpoint');
    assert.deepEqual(save.body, { userId: 'manager-1', commissionBps: 0, status: 'active' }, 'reactivation starts future commissions at zero until individual Stripe eligibility is verified');
  } finally {
    try { cleanupRoots?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test('referral link retry recovers from an actionable error and revisions refetch link plus pools', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
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
  let denyLink = false;
  let unauthorizedCalls = 0;
  let vite;
  let cleanupRoots;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/business/events/event-1/referral-link')) {
      calls.link += 1;
      if (denyLink) return new Response(JSON.stringify({ error: { message: 'Session expired' } }), { status: 401, headers: { 'content-type': 'application/json' } });
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
    vite = await createEventPeopleTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { ReferralLink } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, waitFor, cleanup } = await import('@testing-library/react');
    cleanupRoots = cleanup;
    const { within } = await import('@testing-library/dom');
    const ui = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { event: { id: 'event-1', status: 'published' }, session: { accessToken: 'fixture-token' }, onUnauthorized() { unauthorizedCalls += 1; } };
    const view = render(React.createElement(ReferralLink, { ...props, revision: 0 }), { container: dom.window.document.getElementById('root') });
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
    denyLink = true;
    view.rerender(React.createElement(ReferralLink, { ...props, revision: 2 }));
    await waitFor(() => assert.equal(unauthorizedCalls, 1, 'an expired referral session invokes the unauthorized callback'));
  } finally {
    try { cleanupRoots?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
