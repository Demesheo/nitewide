import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedTestServer } from './helpers/shared-vite-server.js';

const createOverviewTestServer = sharedTestServer();

async function withBusinessDom(run) {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = dom.window.ResizeObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let vite;
  let testing;
  try {
    vite = await createOverviewTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const React = await import('react');
    testing = await import('@testing-library/react');
    const { within } = await import('@testing-library/dom');
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    await run({ businessRoot, dom, vite, React, ...testing, screen, user, within });
  } finally {
    try {
      testing?.cleanup();
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}

const attentionFixture = {
  counts: { pendingGuestlist: 21, pendingInvitations: 6, upcomingEvents: 9, lowInventory: 2 },
  items: [
    { kind: 'pending_guestlist', id: 'guest-1', eventId: 'event-1', title: 'Guestlist request', personName: 'Ari Guest', partySize: 3 },
    { kind: 'pending_invitation', id: 'invite-1', organizationId: 'org-1', title: 'Team invitation', email: 'staff@fixture.test' },
    { kind: 'upcoming_event', eventId: 'event-2', title: 'Friday Preview', startsAt: '2026-10-02T23:00:00.000Z' },
    { kind: 'low_inventory', id: 'offering-1', eventId: 'event-3', title: 'Saturday Late Set', name: 'General Admission', remaining: 4 },
  ],
};

test('Needs attention expands, shows full counts, and preserves routes for supported action kinds', async () => {
  await withBusinessDom(async ({ vite, React, render, screen, user }) => {
    const { OverviewNeedsAttention } = await vite.ssrLoadModule('/src/components/OverviewNeedsAttention.jsx');
    const navigations = [];
    const view = render(React.createElement(OverviewNeedsAttention, {
      attention: attentionFixture, loading: false, error: '', onRetry() {},
      onNavigate: (...args) => navigations.push(args),
    }), { container: document.getElementById('root') });

    const section = screen.getByRole('region', { name: 'Needs attention' });
    assert.equal(screen.getAllByRole('region', { name: 'Needs attention' }).length, 1, 'the standalone section is rendered once');
    const details = section.querySelector('details');
    assert.ok(details, 'actions use native details disclosure');
    assert.equal(details.open, false, 'the action list starts collapsed');
    const tiles = [...section.querySelectorAll('.overview-attention-count')];
    assert.equal(tiles.length, 3, 'upcoming events are not a Needs attention category');
    assert.deepEqual(tiles.map((tile) => [tile.querySelector('strong').textContent, tile.lastElementChild.textContent]), [
      ['21', 'Guestlist requests'], ['6', 'Pending invitations'], ['2', 'Low inventory'],
    ]);
    await user.click(details.querySelector('summary'));
    assert.equal(details.open, true);
    assert.equal(details.querySelectorAll('.overview-attention-list button').length, 3, 'upcoming events are filtered from View actions');
    assert.equal(screen.queryByText('Friday Preview'), null);

    await user.click(screen.getByRole('button', { name: /Guestlist request/ }));
    await user.click(screen.getByRole('button', { name: /Team invitation/ }));
    await user.click(screen.getByRole('button', { name: /Saturday Late Set/ }));
    assert.deepEqual(navigations, [
      ['events', 'event-1', 'guest-1', 'guestlist'],
      ['team', null, null, null],
      ['events', 'event-3', null, null],
    ]);

    view.rerender(React.createElement(OverviewNeedsAttention, {
      attention: { counts: attentionFixture.counts, items: [attentionFixture.items.find((item) => item.kind === 'upcoming_event')] },
      loading: false, error: '', onRetry() {}, onNavigate() {},
    }));
    assert.ok(screen.getByText('No open actions right now.'), 'an upcoming-only response is treated as no open actions');
    assert.equal(screen.queryByText(/View actions/), null, 'upcoming-only responses do not expose the View actions disclosure');

    let retries = 0;
    view.rerender(React.createElement(OverviewNeedsAttention, { attention: null, loading: true, error: '', onRetry() { retries += 1; }, onNavigate() {} }));
    assert.ok(screen.getByText('Loading actions…'), 'an empty section communicates its initial loading state');
    view.rerender(React.createElement(OverviewNeedsAttention, { attention: null, loading: false, error: 'Attention is unavailable', onRetry() { retries += 1; }, onNavigate() {} }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    assert.equal(retries, 1, 'the error offers an actionable retry');
    view.rerender(React.createElement(OverviewNeedsAttention, { attention: { counts: { pendingGuestlist: 0, pendingInvitations: 0, upcomingEvents: 0, lowInventory: 0 }, items: [] }, loading: false, error: '', onRetry() {}, onNavigate() {} }));
    assert.ok(screen.getByText('No open actions right now.'), 'an empty result has a clear empty state');
  });
});

test('Needs attention shows loading, retryable error, and empty state independently of summary availability', async () => {
  await withBusinessDom(async ({ vite, React, render, screen, waitFor, user, within }) => {
    const { BusinessOverview } = await vite.ssrLoadModule('/src/components/BusinessOverview.jsx');
    const priorFetch = globalThis.fetch;
    const calls = { summary: 0, attention: 0 };
    let finishFirstAttention;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === '/api/business/reports/summary') {
        calls.summary += 1;
        return new Response(JSON.stringify({ error: { message: 'Summary is unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/business/overview/needs-attention') {
        calls.attention += 1;
        if (calls.attention === 1) return new Promise((resolve) => { finishFirstAttention = () => resolve(new Response(JSON.stringify({ error: { message: 'Attention is unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } })); });
        return new Response(JSON.stringify({ data: { counts: { pendingGuestlist: 0, pendingInvitations: 0, upcomingEvents: 0, lowInventory: 0 }, items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    };
    const organizationIds = [];
    const venueIds = [];
    try {
      render(React.createElement(BusinessOverview, {
        session: { accessToken: 'fixture-token' }, days: 30, organizationIds, venueIds,
        ownOnly: false, revision: 0, onNavigate() {}, onUnauthorized() {},
      }), { container: document.getElementById('root') });

      const section = await screen.findByRole('region', { name: 'Needs attention' });
      await waitFor(() => assert.equal(calls.attention, 1));
      assert.equal(section.getAttribute('aria-busy'), 'true', 'attention loading is represented within the section');
      assert.equal(screen.getAllByRole('region', { name: 'Needs attention' }).length, 1, 'attention renders even when summary failed, and only once');
      finishFirstAttention();
      await waitFor(() => assert.ok(screen.getAllByRole('alert').some((alert) => /Summary is unavailable/.test(alert.textContent))));
      await waitFor(() => assert.match(section.textContent, /Attention is unavailable/));
      await user.click(within(section).getByRole('button', { name: /Try again/ }));
      await screen.findByText('No open actions right now.');
      assert.equal(calls.attention, 2, 'the section retry refetches attention');
      assert.ok(calls.summary >= 1, 'the summary request was independent and failed separately');
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

test('Needs attention occupies the requested overview slots for business and personal views', async () => {
  await withBusinessDom(async ({ vite, React, render, screen, waitFor }) => {
    const [{ OverviewPresentation }, { PersonalOverview }, { OverviewNeedsAttention }] = await Promise.all([
      vite.ssrLoadModule('/src/components/OverviewPresentation.jsx'),
      vite.ssrLoadModule('/src/components/PersonalOverview.jsx'),
      vite.ssrLoadModule('/src/components/OverviewNeedsAttention.jsx'),
    ]);
    const data = { range: { days: 30 }, events: [], report: {
      summary: { salesCents: 1000, commissionCents: 100, orders: 1, checkedIn: 0, admissions: 1, guestlistPlaces: 0 },
      daily: [], packages: [], events: [],
    } };
    const attention = React.createElement(OverviewNeedsAttention, { attention: attentionFixture, onNavigate() {} });
    const view = render(React.createElement(OverviewPresentation, { data, beforeCharts: attention }), { container: document.getElementById('root') });
    const businessSection = screen.getByRole('region', { name: 'Needs attention' });
    await waitFor(() => screen.getByRole('heading', { name: 'Sales over time' }));
    const metrics = document.querySelector('.metric-grid');
    const revenue = document.querySelector('.revenue-panel');
    assert.ok(metrics.compareDocumentPosition(businessSection) & Node.DOCUMENT_POSITION_FOLLOWING, 'business summary metrics precede Needs attention');
    assert.ok(businessSection.compareDocumentPosition(revenue) & Node.DOCUMENT_POSITION_FOLLOWING, 'Needs attention precedes the Big Picture revenue panel');

    view.rerender(React.createElement(PersonalOverview, {
      data, activeEvents: 3, beforeActivity: attention,
      onEvents() {}, onAnalytics() {}, onGuestlists() {}, eventTable: React.createElement('div', null, 'Fixture activity table'),
    }));
    const personalSection = screen.getByRole('region', { name: 'Needs attention' });
    await waitFor(() => screen.getByRole('heading', { name: 'Sales by event' }));
    const personalMetrics = document.querySelector('.personal-workspace .metric-grid');
    const activity = screen.getByRole('heading', { name: 'Sales by event' }).closest('section');
    assert.ok(personalMetrics.compareDocumentPosition(personalSection) & Node.DOCUMENT_POSITION_FOLLOWING, 'personal metrics precede Needs attention');
    assert.ok(personalSection.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING, 'Needs attention precedes personal activity');
  });
});
