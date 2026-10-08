import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('mobile city suggestions stay bounded in normal form flow without overlaying wrapped submit controls', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const mobile = styles.match(/@media \(max-width: 760px\) \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(mobile, 'The wrapped mobile form has an explicit responsive layout');
  assert.match(mobile, /\.discovery-city-search\s*\{[^}]*flex-direction:\s*column/);
  assert.match(mobile, /\.discovery-city-options\s*\{[^}]*position:\s*static/);
  assert.match(mobile, /\.discovery-city-options\s*\{[^}]*min-width:\s*0/);
  assert.match(mobile, /\.discovery-city-options\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.discovery-city-options\s*\{[^}]*max-height:\s*min\(360px,\s*50dvh\)[^}]*overflow-y:\s*auto/);
});

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
      finish(data, status = 200) { resolveRequest(new Response(JSON.stringify(status === 200 ? { data } : { error: { code: data.code, message: 'Discovery results expired' } }),
        { status, headers: { 'content-type': 'application/json' } })); } });
  });
  let vite, cleanup;
  try {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', ssr: { external: ['@nitewide/pricing'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const { useDiscovery } = await vite.ssrLoadModule('/src/lib/use-discovery.js');
    const { DiscoveryResults } = await vite.ssrLoadModule('/src/components/discovery-results.jsx');
    const { DiscoveryCitySearch } = await vite.ssrLoadModule('/src/components/discovery-city-search.jsx');
    const { DiscoveryDateSearch } = await vite.ssrLoadModule('/src/components/discovery-date-search.jsx');
    const { DiscoveryControls, DiscoverySort } = await vite.ssrLoadModule('/src/components/discovery-controls.jsx');
    const { useCurrentCity } = await vite.ssrLoadModule('/src/lib/use-current-city.js');
    const React = await import('react');
    const testing = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const { renderHook, render, act, waitFor, fireEvent } = testing;
    cleanup = testing.cleanup;
    const filters = (city, extra = {}) => ({ city, date: '', query: '', shortcut: '', scope: 'nearby', sort: 'recommended', ...extra });
    const area = (city = 'Orlando', extra = {}) => ({ key: `us:fl:${city.toLowerCase()}`, city, label: `${city}, FL`, region: 'FL', countryCode: 'US', kind: 'metro', groupLabel: city, ...extra });
    const page = (items = [], extra = {}) => ({ items, nextCursor: null, area: area(), resolutionStatus: 'resolved', hasUpcomingAreaEvents: true, ...extra });
    const event = (id) => ({ id, offerings: [] });
    const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
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
      assert.equal(requests[0].url.searchParams.get('mode'), 'upcoming');
      assert.equal(requests[0].url.searchParams.get('scope'), 'nearby');
      assert.equal(requests[0].url.searchParams.get('sort'), 'recommended');
      assert.equal(requests[0].url.searchParams.get('startDate'), localToday());
      assert.equal(requests[0].url.searchParams.has('endDate'), false);
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

    await t.test('same-metro origin, exact-city scope, and sort changes each reset cards and reject stale pages', async () => {
      requests = [];
      const sameMetro = area('Winter Park', { key: 'metro:orlando' });
      const hook = renderHook(({ city, scope, sort }) => useDiscovery(filters(city, { scope, sort })), {
        initialProps: { city: 'Orlando, FL', scope: 'nearby', sort: 'recommended' },
      });
      assert.equal(requests[0].url.searchParams.get('mode'), 'upcoming');
      await finish(0, page([event('metro-orlando')], { area: sameMetro, nextCursor: 'metro-next' }));
      act(() => { void hook.result.current.loadMore(); });
      assert.equal(requests[1].url.searchParams.get('scope'), 'nearby');
      hook.rerender({ city: 'Winter Park, FL', scope: 'nearby', sort: 'recommended' });
      assert.equal(requests[1].signal.aborted, true);
      assert.equal(hook.result.current.events.length, 0);
      assert.equal(requests[2].url.searchParams.get('city'), 'Winter Park, FL');
      await finish(2, page([event('winter-park')], { area: sameMetro }));
      hook.rerender({ city: 'Winter Park, FL', scope: 'city', sort: 'recommended' });
      assert.equal(hook.result.current.events.length, 0);
      assert.equal(requests[3].url.searchParams.get('scope'), 'city');
      await finish(1, page([event('stale-nearby-page')], { area: sameMetro }));
      assert.deepEqual(hook.result.current.events, []);
      await finish(3, page([event('exact-city')], { area: sameMetro }));
      hook.rerender({ city: 'Winter Park, FL', scope: 'city', sort: 'date' });
      assert.equal(hook.result.current.events.length, 0);
      assert.equal(requests[4].url.searchParams.get('sort'), 'date');
      assert.equal(requests[4].url.searchParams.get('scope'), 'city');
      await finish(4, page([event('date-sorted')], { area: sameMetro, nextCursor: 'date-next' }));
      assert.equal(hook.result.current.events[0].id, 'date-sorted');
      act(() => { void hook.result.current.loadMore(); });
      assert.equal(requests[5].url.searchParams.get('mode'), 'upcoming');
      assert.equal(requests[5].url.searchParams.get('scope'), 'city');
      assert.equal(requests[5].url.searchParams.get('sort'), 'date');
      assert.equal(requests[5].url.searchParams.get('startDate'), localToday());
      assert.equal(requests[5].url.searchParams.has('endDate'), false);
      assert.equal(requests[5].url.searchParams.get('cursor'), 'date-next');
      await finish(5, page([event('date-more')], { area: sameMetro }));
      assert.deepEqual(hook.result.current.events.map(item => item.id), ['date-sorted', 'date-more']);
      hook.unmount();
    });

    await t.test('area/sort controls expose accessible real interactions and report only the changed filter', async () => {
      const changes = [];
      const controls = (scope = 'nearby', sort = 'recommended') => React.createElement(React.Fragment, null,
        React.createElement(DiscoveryControls, { city: 'Winter Park, FL', scope, onChange: change => changes.push(change) }),
        React.createElement(DiscoverySort, { sort, onChange: change => changes.push(change) }));
      const view = render(controls());
      const group = view.getByRole('group', { name: 'Discovery area' });
      const nearby = view.getByRole('button', { name: 'Include nearby cities', exact: true });
      const exact = view.getByRole('button', { name: 'Winter Park only', exact: true });
      const sortSelect = view.getByRole('combobox', { name: 'Sort' });
      assert.equal(nearby.getAttribute('aria-pressed'), 'true');
      assert.equal(exact.getAttribute('aria-pressed'), 'false');
      assert.equal(sortSelect.value, 'recommended');
      assert.ok(view.getByRole('option', { name: 'Popular', exact: true }));
      assert.ok(view.getByRole('option', { name: 'Distance', exact: true }));
      assert.ok(view.getByRole('option', { name: 'Soonest', exact: true }));
      assert.equal(view.queryByText('Sort', { exact: true }), null, 'the control remains accessibly labeled without a redundant visible caption');
      await user.click(exact);
      await user.selectOptions(sortSelect, 'date');
      assert.deepEqual(changes, [{ scope: 'city' }, { sort: 'date' }]);
      view.rerender(controls('city', 'date'));
      assert.equal(view.getByRole('button', { name: 'Winter Park only', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(view.getByRole('combobox', { name: 'Sort' }).value, 'date');
      assert.equal(group.getAttribute('aria-label'), 'Discovery area');
      view.unmount();
    });

    await t.test('Use current location explicitly requests precise lookup and ignores a result after manual city edit', async () => {
      const attempts = [], detected = [];
      let starts = 0;
      const detectCity = options => new Promise(resolveRequest => attempts.push({ options, resolve: resolveRequest }));
      function LocationChooser() {
        const [value, setValue] = React.useState('');
        const current = useCurrentCity({ detectCity, onStart: () => { starts++; }, onDetected: city => { detected.push(city); setValue(city); } });
        return React.createElement(React.Fragment, null,
          React.createElement(DiscoveryCitySearch, { value,
            onChange(next) { current.cancel(); setValue(next); }, onLocate: current.locate, locating: current.locating }),
          React.createElement('button', { type: 'button', onClick: current.cancel }, 'Open booked'));
      }
      const view = render(React.createElement(LocationChooser));
      const locate = view.getByRole('button', { name: 'Use current location', exact: true });
      await user.click(locate);
      await waitFor(() => assert.equal(attempts.length, 1));
      assert.equal(starts, 1);
      assert.equal(attempts[0].options.requestPrecise, true);
      assert.equal(attempts[0].options.signal.aborted, false);
      assert.equal(locate.getAttribute('aria-busy'), 'true');
      const input = view.getByRole('combobox', { name: 'City' });
      assert.equal(input.getAttribute('name'), 'discovery-place-query');
      assert.equal(input.type, 'search');
      assert.equal(input.autocomplete, 'off');
      assert.equal(input.getAttribute('spellcheck'), 'false');
      fireEvent.change(input, { target: { value: 'Winter Park, FL' } });
      assert.equal(attempts[0].options.signal.aborted, true);
      await act(async () => { attempts[0].resolve('Miami, FL'); });
      assert.equal(input.value, 'Winter Park, FL');
      assert.deepEqual(detected, []);
      assert.equal(locate.disabled, false);
      await user.click(locate);
      await waitFor(() => assert.equal(attempts.length, 2));
      assert.equal(attempts[1].options.requestPrecise, true);
      await act(async () => { attempts[1].resolve('Winter Park, FL'); });
      assert.equal(input.value, 'Winter Park, FL');
      assert.deepEqual(detected, ['Winter Park, FL']);
      await user.click(locate);
      await waitFor(() => assert.equal(attempts.length, 3));
      await user.click(view.getByRole('button', { name: 'Open booked', exact: true }));
      assert.equal(attempts[2].options.signal.aborted, true);
      await act(async () => { attempts[2].resolve('Orlando, FL'); });
      assert.equal(input.value, 'Winter Park, FL');
      assert.deepEqual(detected, ['Winter Park, FL']);
      view.unmount();
    });

    await t.test('distance sort labels missing and private coordinates as unavailable', () => {
      const resultEvent = (id, location, distanceMiles) => ({ id, title: id, startsAt: '2026-10-08T23:00:00Z', endsAt: '2026-10-09T03:00:00Z',
        location, distanceMiles, offerings: [], guestlistCapacity: 0 });
      const props = { submitted: filters('Winter Park, FL', { sort: 'distance' }), area: area('Winter Park'), distanceOrigin: { label: 'Winter Park, FL', kind: 'city-center' },
        resolutionStatus: 'resolved', hasUpcomingAreaEvents: true,
        results: [resultEvent('missing', { city: 'Orlando', region: 'FL', timezone: 'America/New_York', privacy: 'public' }, null),
          resultEvent('private', { city: 'Orlando', region: 'FL', timezone: 'America/New_York', privacy: 'private' }, 0),
          resultEvent('known', { city: 'Orlando', region: 'FL', timezone: 'America/New_York', privacy: 'public' }, 6.2)],
        loadState: 'ready', nextCursor: null, moreState: 'idle', loadEvents() {}, loadMore() {}, saved: [], save() {}, openEvent() {},
        weekRange: null, weeklyEvents: [], previewState: 'idle', previewCursor: null, visible: true };
      const view = render(React.createElement(DiscoveryResults, props));
      assert.equal(view.getAllByText('Distance unavailable').length, 2);
      assert.ok(view.getByText('6.2 mi from Winter Park, FL city center'));
      assert.equal(view.queryByText('0 mi from Winter Park, FL city center'), null);
      view.unmount();
    });

    await t.test('an expired cursor offers a fresh first-page request instead of retrying the stale cursor', async () => {
      requests = [];
      let observed;
      function ResultsHarness() {
        observed = useDiscovery(filters('Orlando, FL'));
        return React.createElement(DiscoveryResults, { submitted: filters('Orlando, FL'), area: observed.area,
          resolutionStatus: observed.resolutionStatus, hasUpcomingAreaEvents: observed.hasUpcomingAreaEvents, results: observed.events,
          loadState: observed.loadState, nextCursor: observed.nextCursor, moreState: observed.moreState, loadEvents: observed.reload,
          loadMore: observed.loadMore, saved: [], save() {}, openEvent() {}, weekRange: null, weeklyEvents: [],
          previewState: observed.previewState, previewCursor: observed.previewCursor, visible: true });
      }
      const view = render(React.createElement(ResultsHarness));
      await finish(0, page([event('first-page')], { nextCursor: 'expired-cursor' }));
      await user.click(view.getByRole('button', { name: 'More nights, more possibilities' }));
      await waitFor(() => assert.equal(requests.length, 2));
      assert.equal(requests[1].url.searchParams.get('cursor'), 'expired-cursor');
      await act(async () => { requests[1].finish({ code: 'DISCOVERY_CURSOR_EXPIRED' }, 422); });
      assert.equal(observed.moreState, 'expired');
      await user.click(view.getByRole('button', { name: 'Refresh results', exact: true }));
      await waitFor(() => assert.equal(requests.length, 3));
      assert.equal(requests[2].url.searchParams.has('cursor'), false);
      await finish(2, page([event('refreshed-first-page')]));
      assert.deepEqual(observed.events.map(item => item.id), ['refreshed-first-page']);
      view.unmount();
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
      assert.equal(requests[0].url.searchParams.get('mode'), 'range');
      assert.equal(requests[0].url.searchParams.get('scope'), 'nearby');
      assert.equal(requests[0].url.searchParams.get('sort'), 'recommended');
      assert.equal(requests[0].url.searchParams.get('startDate'), '2026-10-07');
      assert.equal(requests[0].url.searchParams.get('endDate'), '2026-10-07');
      assert.equal(requests[1].url.searchParams.get('mode'), 'range');
      assert.equal(requests[1].url.searchParams.get('startDate'), '2026-10-08');
      assert.equal(requests[1].url.searchParams.get('endDate'), '2026-10-14');
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
      assert.ok(view.getByText(/Nearby results include only public event locations with confirmed coordinates/));
      assert.equal(view.queryByText(/Nitewide coming soon/), null);
      for (const loadState of ['error', 'loading', 'unselected']) {
        view.rerender(React.createElement(DiscoveryResults, { ...props, loadState }));
        assert.equal(view.queryByText(/Nitewide coming soon/), null);
      }
      view.unmount();
    });

    await t.test('City combobox shows at most five clean city labels, supports keyboard choice and rejects stale responses', async () => {
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
      const oversizedChoices = Array.from({ length: 12 }, (_, index) => ({ key: `place:${index}`,
        label: index ? `Winter ${index}, FL` : 'Winter Park, FL', groupLabel: 'Orlando–Kissimmee–Sanford, FL' }));
      oversizedChoices.splice(1, 0, { ...oversizedChoices[0], label: 'Duplicate alias, FL' });
      await finish(0, { items: oversizedChoices, hasMore: true });
      assert.equal(view.getAllByRole('option').length, 5);
      assert.ok(view.getByRole('option', { name: 'Winter Park, FL', exact: true }));
      assert.equal(view.queryByRole('option', { name: 'Duplicate alias, FL' }), null);
      assert.equal(view.queryByText('Orlando–Kissimmee–Sanford, FL'), null);
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

    await t.test('city suggestions wait for the longer typing pause before querying', async () => {
      requests = [];
      function CitySearch() {
        const [value, setValue] = React.useState('');
        return React.createElement(DiscoveryCitySearch, { value, onChange: setValue });
      }
      const view = render(React.createElement(CitySearch));
      const input = view.getByRole('combobox', { name: 'City' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Winter' } });
      await new Promise(resolveTimer => setTimeout(resolveTimer, 300));
      assert.equal(requests.length, 0, 'typing pauses shorter than the debounce do not issue a request');
      await waitFor(() => assert.equal(requests.length, 1));
      assert.deepEqual([...requests[0].url.searchParams], [['q', 'Winter']]);
      view.unmount();
      assert.equal(requests[0].signal.aborted, true);
    });

    await t.test('date picker has an accessible button that opens the native picker and keeps the date editable', async () => {
      const changes = [];
      const view = render(React.createElement(DiscoveryDateSearch, { value: '', onChange: value => changes.push(value) }));
      const input = view.getByLabelText('Event date');
      const openPicker = view.getByRole('button', { name: 'Open date picker', exact: true });
      let pickerCalls = 0;
      Object.defineProperty(input, 'showPicker', { configurable: true, value() { pickerCalls++; } });
      await user.click(openPicker);
      assert.equal(pickerCalls, 1);
      assert.equal(dom.window.document.activeElement, input);
      fireEvent.change(input, { target: { value: '2026-10-21' } });
      assert.deepEqual(changes, ['2026-10-21']);
      view.rerender(React.createElement(DiscoveryDateSearch, { value: '2026-10-21', onChange: value => changes.push(value) }));
      assert.equal(view.getByLabelText('Event date').value, '2026-10-21');
      await user.click(view.getByRole('button', { name: 'Reset to upcoming', exact: true }));
      assert.equal(changes[0], '2026-10-21');
      assert.equal(changes.at(-1), '');
      view.unmount();
    });

    await t.test('manual qualified-city submit works with ready, pending and failed suggestions without choosing or dismissing one', async () => {
      for (const status of ['ready', 'pending', 'error']) {
        requests = [];
        const submissions = [];
        const pointerStates = [];
        function CityForm() {
          const [value, setValue] = React.useState('');
          return React.createElement('form', { className: 'search-bar', onSubmit(event) {
            event.preventDefault();
            submissions.push(new dom.window.FormData(event.currentTarget).get('discovery-place-query'));
          } }, React.createElement(DiscoveryCitySearch, { value, onChange: setValue }),
          React.createElement('button', { type: 'submit', className: 'search-submit',
            onPointerDown(event) { pointerStates.push({ phase: 'down', menu: Boolean(event.currentTarget.form.querySelector('[role="listbox"]')) }); },
            onPointerUp(event) { pointerStates.push({ phase: 'up', menu: Boolean(event.currentTarget.form.querySelector('[role="listbox"]')),
              cityFocused: dom.window.document.activeElement?.getAttribute('name') === 'discovery-place-query' }); },
          }, 'Find my night'));
        }
        const view = render(React.createElement(CityForm));
        const input = view.getByRole('combobox', { name: 'City' });
        await user.click(input);
        await user.type(input, 'Miami, FL');
        await waitFor(() => assert.equal(requests.length, 1));
        if (status === 'ready') {
          await finish(0, { items: [{ key: 'miami', label: 'Miami, FL' }, { key: 'beach', label: 'Miami Beach, FL' }] });
          assert.equal(view.getAllByRole('option').length, 2);
        } else if (status === 'error') await fail(0);
        assert.equal(input.getAttribute('aria-expanded'), 'true', status);
        await user.click(view.getByRole('button', { name: 'Find my night' }));
        assert.deepEqual(pointerStates, [{ phase: 'down', menu: true }, { phase: 'up', menu: true, cityFocused: true }], status);
        assert.deepEqual(submissions, ['Miami, FL'], status);
        assert.notEqual(dom.window.document.activeElement, input, status);
        assert.equal(input.value, 'Miami, FL', status);
        assert.equal(input.getAttribute('aria-expanded'), 'false', status);
        assert.equal(requests[0].signal.aborted, true, status);
        if (status === 'pending') {
          await finish(0, { items: [{ key: 'late', label: 'Another city, FL' }] });
          assert.equal(view.queryByRole('option'), null);
          assert.equal(input.value, 'Miami, FL');
        }
        view.unmount();
      }
    });

    await t.test('Tab to same-form submit keeps geometry stable until Enter; leaving submit focus closes normally', async () => {
      requests = [];
      const submissions = [];
      function CityForm() {
        const [value, setValue] = React.useState('Miami, FL');
        return React.createElement(React.Fragment, null,
          React.createElement('form', { onSubmit(event) {
            event.preventDefault(); submissions.push(new dom.window.FormData(event.currentTarget).get('discovery-place-query'));
          } }, React.createElement(DiscoveryCitySearch, { value, onChange: setValue }),
          React.createElement('button', { type: 'submit' }, 'Find my night')),
          React.createElement('input', { 'aria-label': 'Outside field' }));
      }
      const view = render(React.createElement(CityForm));
      const input = view.getByRole('combobox', { name: 'City' });
      const submit = view.getByRole('button', { name: 'Find my night' });
      await user.click(input);
      await waitFor(() => assert.equal(requests.length, 1));
      await finish(0, { items: [{ key: 'miami', label: 'Miami, FL' }] });
      await user.tab();
      assert.equal(dom.window.document.activeElement, submit);
      assert.equal(input.getAttribute('aria-expanded'), 'true');
      await user.keyboard('{Enter}');
      assert.deepEqual(submissions, ['Miami, FL']);
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      await user.click(input);
      await waitFor(() => assert.equal(requests.length, 2));
      await user.tab();
      assert.equal(dom.window.document.activeElement, submit);
      assert.equal(input.getAttribute('aria-expanded'), 'true');
      await user.tab();
      assert.equal(dom.window.document.activeElement, view.getByRole('textbox', { name: 'Outside field' }));
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      assert.equal(requests[1].signal.aborted, true);
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
      await finish(0, { items: Array.from({ length: 5 }, (_, index) => ({ key: `place:${index}`,
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
      assert.equal(input.getAttribute('aria-activedescendant'), options[3].id);
      assert.deepEqual(scrolls.at(-1), { index: 3, settings: { block: 'nearest' } });
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
