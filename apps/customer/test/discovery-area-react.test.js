import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('area-scoped discovery guards real React renders, refreshes and late requests', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://customer.fixture.test/', pretendToBeVisual: true });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const priorFetch = globalThis.fetch;
  let requests = [];
  // Deliberately ignore AbortSignal: guards must reject stale responses even
  // when a completed transport/body cannot be canceled in time.
  globalThis.fetch = (input, options) => new Promise((resolveRequest, reject) => {
    requests.push({ url: new URL(String(input), dom.window.location.href), signal: options.signal, reject,
      finish(data) { resolveRequest(new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })); } });
  });
  let vite, cleanup;
  try {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', ssr: { external: ['@nitewide/pricing'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const { useDiscovery } = await vite.ssrLoadModule('/src/lib/use-discovery.js');
    const { DiscoveryResults } = await vite.ssrLoadModule('/src/components/discovery-results.jsx');
    const { DiscoveryCitySearch } = await vite.ssrLoadModule('/src/components/discovery-city-search.jsx');
    const React = await import('react');
    const testing = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const { renderHook, render, act, waitFor, fireEvent } = testing;
    cleanup = testing.cleanup;
    const filters = (city, extra = {}) => ({ city, date: '', query: '', shortcut: '', ...extra });
    const area = (city = 'Orlando', extra = {}) => ({ key: `us:fl:${city.toLowerCase()}`, city, label: `${city}, FL`, region: 'FL', countryCode: 'US', kind: 'metro', groupLabel: city, ...extra });
    const page = (items = [], extra = {}) => ({ items, nextCursor: null, area: area(), resolutionStatus: 'resolved', hasUpcomingAreaEvents: true, ...extra });
    const event = (id) => ({ id, offerings: [] });
    async function finish(index, data) { await act(async () => { requests[index].finish(data); }); }
    async function fail(index) { await act(async () => { requests[index].reject(new Error('Synthetic transport failure')); }); }

    await t.test('unresolved/bare cities make no discovery request; qualified suburbs preserve the requested city', async () => {
      requests = [];
      const hook = renderHook(({ city }) => useDiscovery(filters(city)), { initialProps: { city: '' } });
      assert.equal(hook.result.current.loadState, 'unselected'); assert.equal(requests.length, 0);
      hook.rerender({ city: 'Orlando' }); assert.equal(requests.length, 0);
      hook.rerender({ city: 'Winter Park, Florida' });
      assert.equal(requests[0].url.searchParams.get('city'), 'Winter Park, FL');
      assert.equal(requests[0].url.searchParams.get('pageSize'), '9');
      assert.equal(hook.result.current.events.length, 0);
      await finish(0, page([event('nearby')])); assert.equal(hook.result.current.events[0].id, 'nearby');
      act(() => hook.result.current.reload());
      assert.equal(hook.result.current.loadState, 'refreshing'); assert.equal(hook.result.current.events[0].id, 'nearby');
      await fail(1); assert.equal(hook.result.current.loadState, 'error-refresh'); assert.equal(hook.result.current.events[0].id, 'nearby');
      hook.unmount();
    });

    await t.test('area switch clears before effects, failure never retains old cards, late pagination cannot append', async () => {
      requests = []; const frames = [];
      const hook = renderHook(({ city }) => {
        const result = useDiscovery(filters(city));
        React.useLayoutEffect(() => { frames.push({ city, ids: result.events.map((item) => item.id) }); });
        return result;
      }, { initialProps: { city: 'Orlando, FL' } });
      await finish(0, page([event('orlando')], { nextCursor: 'opaque-next-page' }));
      act(() => { void hook.result.current.loadMore(); });
      hook.rerender({ city: 'Miami, FL' });
      assert.equal(requests[1].signal.aborted, true);
      assert.ok(frames.filter((frame) => frame.city === 'Miami, FL').every((frame) => frame.ids.length === 0));
      assert.equal(hook.result.current.events.length, 0); assert.equal(hook.result.current.loadState, 'loading');
      await fail(2); assert.equal(hook.result.current.loadState, 'error');
      await finish(1, page([event('stale-orlando')])); assert.equal(hook.result.current.events.length, 0);
      hook.rerender({ city: '' }); assert.equal(hook.result.current.loadState, 'unselected'); assert.equal(requests.length, 3);
      hook.unmount();
    });

    await t.test('late initial pages are ignored and preview is suppressed only for verified no-upcoming-area state', async () => {
      requests = [];
      const hook = renderHook(({ city }) => useDiscovery(filters(city, { date: '2026-10-07' })), { initialProps: { city: 'Orlando, FL' } });
      hook.rerender({ city: 'Toronto, ON, CA' });
      await finish(0, page([event('late-main')])); assert.equal(hook.result.current.events.length, 0);
      await finish(1, page([], { hasUpcomingAreaEvents: false }));
      assert.equal(hook.result.current.hasUpcomingAreaEvents, false); assert.equal(requests.length, 2);
      assert.equal(hook.result.current.previewState, 'idle');
      hook.rerender({ city: 'Orlando, FL' }); await finish(2, page());
      await waitFor(() => assert.equal(requests.length, 4));
      assert.equal(requests[3].url.searchParams.get('city'), 'Orlando, FL');
      assert.equal(requests[3].url.searchParams.get('startDate'), '2026-10-08');
      hook.rerender({ city: 'Miami, FL' }); await finish(3, page([event('stale-preview')]));
      assert.equal(hook.result.current.previewEvents.length, 0);
      await finish(4, page([], { hasUpcomingAreaEvents: false }));
      hook.unmount();
    });

    await t.test('preview pagination is independently guarded across query/area changes', async () => {
      requests = [];
      const hook = renderHook(({ city }) => useDiscovery(filters(city, { date: '2026-10-07' })), { initialProps: { city: 'Orlando, FL' } });
      await finish(0, page()); await finish(1, page([event('next-week')], { nextCursor: 'preview-next' }));
      act(() => { void hook.result.current.loadMore(true); });
      assert.equal(requests[2].url.searchParams.get('cursor'), 'preview-next');
      hook.rerender({ city: 'Miami, FL' });
      assert.equal(requests[2].signal.aborted, true);
      await finish(2, page([event('late-preview-more')]));
      assert.equal(hook.result.current.previewEvents.length, 0);
      await fail(3); assert.equal(hook.result.current.loadState, 'error');
      hook.unmount();
    });

    await t.test('unresolved coverage cannot launch a preview, and pagination cannot cross server scopes', async () => {
      requests = [];
      const hook = renderHook(({ city }) => useDiscovery(filters(city, { date: '2026-10-07' })), { initialProps: { city: 'Unknown, TX' } });
      await finish(0, page([], { area: { key: 'us:tx:unknown', label: 'Unknown, TX', city: 'Unknown', kind: 'city' },
        resolutionStatus: 'unresolved', hasUpcomingAreaEvents: null }));
      assert.equal(hook.result.current.previewState, 'idle'); assert.equal(requests.length, 1);
      hook.rerender({ city: 'Orlando, FL' });
      await finish(1, page([event('orlando')], { nextCursor: 'next' }));
      act(() => { void hook.result.current.loadMore(); });
      await finish(2, page([event('wrong-scope')], { area: area('Miami') }));
      assert.deepEqual(hook.result.current.events.map((item) => item.id), ['orlando']);
      assert.equal(hook.result.current.moreState, 'error');
      hook.unmount();
    });

    await t.test('coming soon needs successful area-availability evidence and provides the real configured Business anchor', () => {
      dom.window.__NITEWIDE_PUBLIC_CONFIG__ = { businessHome: 'https://business.fixture.test/' };
      const props = { submitted: filters('Gainesville, FL'), area: area('Gainesville'), resolutionStatus: 'resolved', hasUpcomingAreaEvents: false,
        results: [], loadState: 'ready', nextCursor: null, moreState: 'idle', saved: [],
        discoveryRange: { start: '2026-10-07', end: '2026-10-13' }, weeklyEvents: [], visible: false };
      const view = render(React.createElement(DiscoveryResults, props));
      assert.ok(view.getByRole('heading', { name: 'Nitewide coming soon to Gainesville' }));
      assert.equal(view.getByRole('link', { name: 'Nitewide Business' }).href, 'https://business.fixture.test/');
      view.rerender(React.createElement(DiscoveryResults, { ...props, hasUpcomingAreaEvents: true, submitted: filters('Gainesville, FL', { query: 'not-a-match' }) }));
      assert.ok(view.getByRole('heading', { name: 'No experiences match this search.' }));
      assert.equal(view.queryByText(/Nitewide coming soon/), null);
      view.rerender(React.createElement(DiscoveryResults, { ...props, resolutionStatus: 'unresolved' }));
      assert.ok(view.getByRole('heading', { name: 'Nearby coverage is not confirmed yet.' }));
      assert.equal(view.queryByText(/Nitewide coming soon/), null);
      view.rerender(React.createElement(DiscoveryResults, { ...props, hasUpcomingAreaEvents: null,
        area: area('Gainesville', { kind: 'radius', radiusMiles: 30, centerLabel: 'Gainesville, FL', geographyCoverage: 'verified-addresses-only' }) }));
      assert.ok(view.getByRole('heading', { name: 'Nearby coverage is not confirmed yet.' }));
      assert.ok(view.getByText(/Within 30 miles of Gainesville, FL city center/));
      assert.ok(view.getByText(/Nearby results include only public event locations with confirmed coordinates/));
      assert.equal(view.queryByText(/Nitewide coming soon/), null);
      for (const loadState of ['error', 'loading', 'unselected']) {
        view.rerender(React.createElement(DiscoveryResults, { ...props, loadState }));
        assert.equal(view.queryByText(/Nitewide coming soon/), null);
      }
      view.unmount();
    });

    await t.test('City combobox bounds suggestions, supports keyboard choice and rejects stale responses', async () => {
      requests = [];
      let submissions = 0;
      function CityForm() {
        const [value, setValue] = React.useState('');
        return React.createElement('form', { onSubmit(event) { event.preventDefault(); submissions++; } },
          React.createElement(DiscoveryCitySearch, { value, onChange: setValue, placeholder: 'City, state or region' }),
          React.createElement('button', { type: 'submit' }, 'Find my night'));
      }
      const view = render(React.createElement(CityForm));
      const input = view.getByRole('combobox', { name: 'City' });
      fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Win' } });
      await waitFor(() => assert.equal(requests.length, 1));
      assert.equal(requests[0].url.pathname, '/api/discovery/areas');
      assert.deepEqual([...requests[0].url.searchParams], [['q', 'Win']]);
      await finish(0, { items: Array.from({ length: 12 }, (_, index) => ({ key: `place:${index}`,
        label: index ? `Winter ${index}, FL` : 'Winter Park, FL', groupLabel: 'Orlando–Kissimmee–Sanford, FL' })), hasMore: true });
      assert.equal(view.getAllByRole('option').length, 8);
      assert.equal(view.getByRole('listbox', { name: 'City suggestions' }).id, input.getAttribute('aria-controls'));
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      assert.equal(input.getAttribute('aria-activedescendant'), view.getAllByRole('option')[0].id);
      assert.equal(fireEvent.keyDown(input, { key: 'Enter' }), false, 'Selecting an option must prevent form submission');
      assert.equal(input.value, 'Winter Park, FL');
      assert.equal(submissions, 0);
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      fireEvent.change(input, { target: { value: 'Mia' } });
      await waitFor(() => assert.equal(requests.length, 2));
      fireEvent.change(input, { target: { value: 'Tam' } });
      assert.equal(requests[1].signal.aborted, true);
      assert.equal(view.queryByRole('option'), null);
      await waitFor(() => assert.equal(requests.length, 3));
      await finish(1, { items: [{ key: 'miami', label: 'Miami, FL' }] });
      assert.equal(view.queryByRole('option'), null);
      await finish(2, { items: [{ key: 'tampa', label: 'Tampa, FL' }] });
      assert.ok(view.getByRole('option', { name: 'Tampa, FL' }));
      fireEvent.keyDown(input, { key: 'Escape' });
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      fireEvent.focus(input);
      await waitFor(() => assert.equal(requests.length, 4));
      await fail(3);
      assert.ok(view.getByText(/City suggestions are unavailable/));
      fireEvent.click(view.getByRole('button', { name: 'try again' }));
      await waitFor(() => assert.equal(requests.length, 5));
      fireEvent.blur(input);
      assert.equal(requests[4].signal.aborted, true);
      await finish(4, { items: [{ key: 'stale', label: 'Stale, FL' }] });
      assert.equal(view.queryByRole('option'), null);
      assert.equal(input.value, 'Tam', 'A suggestion failure must preserve the editable city draft');
      view.unmount();
    });

    await t.test('keyboard focus can reach suggestion retry and returns to City while retrying', async () => {
      requests = [];
      function CityForm() {
        const [value, setValue] = React.useState('Win');
        return React.createElement('form', null,
          React.createElement(DiscoveryCitySearch, { value, onChange: setValue }),
          React.createElement('input', { 'aria-label': 'Event date' }));
      }
      const view = render(React.createElement(CityForm));
      const input = view.getByRole('combobox', { name: 'City' });
      await user.click(input);
      await waitFor(() => assert.equal(requests.length, 1));
      await fail(0);
      const retryButton = view.getByRole('button', { name: 'try again' });
      await user.tab();
      assert.equal(dom.window.document.activeElement, retryButton);
      assert.equal(input.getAttribute('aria-expanded'), 'true');
      assert.equal(view.getByRole('button', { name: 'try again' }), retryButton);
      await user.keyboard('{Enter}');
      assert.equal(dom.window.document.activeElement, input);
      assert.equal(input.getAttribute('aria-expanded'), 'true');
      await waitFor(() => assert.equal(requests.length, 2));
      assert.equal(requests[1].url.searchParams.get('q'), 'Win');
      await user.tab();
      assert.equal(dom.window.document.activeElement, view.getByRole('textbox', { name: 'Event date' }));
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      assert.equal(requests[1].signal.aborted, true);
      view.unmount();
    });

    await t.test('keyboard active suggestions scroll into view at the bottom and when moving back up', async () => {
      requests = [];
      function CitySearch() {
        const [value, setValue] = React.useState('Win');
        return React.createElement(DiscoveryCitySearch, { value, onChange: setValue });
      }
      const view = render(React.createElement(CitySearch));
      const input = view.getByRole('combobox', { name: 'City' });
      await user.click(input);
      await waitFor(() => assert.equal(requests.length, 1));
      await finish(0, { items: Array.from({ length: 8 }, (_, index) => ({ key: `place:${index}`,
        label: `Winter ${index}, FL`, groupLabel: 'Orlando–Kissimmee–Sanford, FL' })) });
      const options = view.getAllByRole('option');
      const scrolls = [];
      options.forEach((option, index) => { option.scrollIntoView = (settings) => scrolls.push({ index, settings }); });
      for (let index = 0; index < options.length; index++) {
        await user.keyboard('{ArrowDown}');
        assert.equal(input.getAttribute('aria-activedescendant'), options[index].id);
        assert.deepEqual(scrolls.at(-1), { index, settings: { block: 'nearest' } });
      }
      await user.keyboard('{ArrowUp}');
      assert.equal(input.getAttribute('aria-activedescendant'), options[6].id);
      assert.deepEqual(scrolls.at(-1), { index: 6, settings: { block: 'nearest' } });
      assert.equal(dom.window.document.activeElement, input);
      view.unmount();
    });
  } finally {
    cleanup?.();
    if (vite) await vite.close();
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
