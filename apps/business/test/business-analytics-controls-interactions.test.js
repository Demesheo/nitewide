import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('analytics table controls stay with the active table and preserve URL scope', { timeout: 30000 }, async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app?section=analytics&reportPeriod=7&reportTable=regions&reportPage=4&reportPageSize=10&reportSort=events_desc&reportSearch=seed&reportTeamSearch=stale&reportRegions=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC',
    pretendToBeVisual: true,
  });
  dom.window.showSaveFilePicker = async () => ({ createWritable: async () => new WritableStream() });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLSelectElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  const requests = [];
  let failInitialSummary;
  const initialSummary = new Promise((_, reject) => { failInitialSummary = reject; });
  let firstSummary = true;
  let finishExport;
  const exportGate = new Promise((resolve) => { finishExport = resolve; });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), dom.window.location.href);
    requests.push(url);
    if (url.pathname === '/api/business/reports/export.csv') return exportGate;
    let data = {};
    if (url.pathname === '/api/business/reports/summary') {
      if (firstSummary) { firstSummary = false; await initialSummary; }
      const matchesRewind = url.searchParams.get('search')?.toLowerCase() === 'rew1nd';
      const eventId = url.searchParams.get('eventId');
      const personId = url.searchParams.get('personId');
      data = { summary: { salesCents: matchesRewind ? 6740 : 10000, commissionCents: 0, directSalesCents: 0,
        orders: matchesRewind ? 20 : 2, customers: matchesRewind ? 12 : 2, units: matchesRewind ? 20 : 2,
        admissions: matchesRewind ? 20 : 2, checkedIn: 0, guestlistPlaces: 0,
        events: eventId ? 1 : matchesRewind ? 4 : 1, averageOrderCents: matchesRewind ? 337 : 5000 },
      event: eventId ? { id: eventId, label: 'Autumn Preview', startsAt: '2026-09-20T20:00:00Z' } : null,
      person: personId ? { id: personId, label: 'Avery Promoter' } : null,
      daily: [], offerings: [], eventMix: [], regionalMix: [] };
    } else if (url.pathname === '/api/business/reports/events') {
      const search = url.searchParams.get('search')?.toLowerCase();
      const items = search === 'rew1nd'
        ? [{ id: '00000000-0000-4000-8000-000000000001', eventId: '00000000-0000-4000-8000-000000000001', label: 'Rew1nd Late Night', startsAt: '2026-09-20T20:00:00Z', status: 'published', orders: 7, customers: 5, salesCents: 1750, checkedIn: 0 },
          { id: 'event-2', eventId: 'event-2', label: 'Rew1nd After Hours', startsAt: '2026-09-21T20:00:00Z', status: 'published', orders: 5, customers: 3, salesCents: 1600, checkedIn: 0 },
          { id: 'event-4', eventId: 'event-4', label: 'Rew1nd Sunset Sessions', startsAt: '2026-09-22T20:00:00Z', status: 'published', orders: 4, customers: 3, salesCents: 1690, checkedIn: 0 },
          { id: 'event-5', eventId: 'event-5', label: 'Rew1nd Closing Set', startsAt: '2026-09-23T20:00:00Z', status: 'published', orders: 4, customers: 1, salesCents: 1700, checkedIn: 0 }]
        : search === 'early'
          ? [{ id: 'event-3', eventId: 'event-3', label: 'Early Preview', startsAt: '2026-09-19T20:00:00Z', status: 'published', orders: 1, customers: 1, salesCents: 2500, checkedIn: 0 }]
          : [{ id: '00000000-0000-4000-8000-000000000001', eventId: '00000000-0000-4000-8000-000000000001', label: 'Autumn Preview', startsAt: '2026-09-20T20:00:00Z', status: 'published', orders: 2, customers: 2, salesCents: 10000, checkedIn: 0 }];
      data = { items, total: items.length,
      page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 10), hasMore: false };
    } else if (url.pathname === '/api/business/reports/team') {
      data = { items: [{ id: 'person-1', label: 'Avery Promoter', role: 'Promoter', salesCents: 5000,
        orders: 1, guestlistPlaces: 0, approvedGuestlistPlaces: 0, commissionCents: 0 }], total: 1,
      page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 10), hasMore: false };
    } else if (/^\/api\/business\/reports\/(regions|venues|offerings|customers)$/.test(url.pathname)) {
      const selectedOffering = url.searchParams.get('offeringName');
      const offerings = (url.searchParams.get('eventId') || url.searchParams.get('personId')) && url.pathname.endsWith('/offerings');
      const regions = url.pathname.endsWith('/regions') ? [{ id: 'Orlando, FL, US', label: 'Orlando, FL, US', events: 1, orders: 2, salesCents: 10000, customers: 2, units: 2, checkedIn: 0 }] : [];
      const venues = url.pathname.endsWith('/venues') ? [{ id: 'venue-a', label: 'North Room', organizationId: 'org-a', events: 1, orders: 2, salesCents: 10000, customers: 2, units: 2, checkedIn: 0 }] : [];
      const items = offerings ? [{ id: 'ticket:General Admission', label: 'General Admission', kind: 'ticket', units: 2, orders: 2, salesCents: 10000 }]
        : url.pathname.endsWith('/customers') ? [{ id: 'buyer-a', label: 'Buyer A', orders: 1, salesCents: selectedOffering ? 4000 : 10000 }]
        : regions.length ? regions : venues;
      data = { items,
        total: items.length, page: Number(url.searchParams.get('page') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 10), hasMore: false };
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot,
      logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessAnalytics } = await vite.ssrLoadModule('/src/components/BusinessAnalytics.jsx');
    const React = await import('react');
    const { act, render, screen, waitFor, within } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const view = render(React.createElement(BusinessAnalytics, {
      session: { accessToken: 'fixture-token' }, organizations: [{ id: 'org-a', name: 'North Hall' }, { id: 'org-b', name: 'South Hall' }],
      venues: [{ id: 'venue-a', label: 'North Room', organizationId: 'org-a', location: { city: 'Orlando', region: 'FL', countryCode: 'US' } },
        { id: 'venue-b', label: 'South Room', organizationId: 'org-b', location: { city: 'Miami', region: 'FL', countryCode: 'US' } }],
      onEvent() {}, onUnauthorized() {},
    }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await screen.findByRole('heading', { name: 'Regions' });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary')));
    const initialSearchButton = () => screen.getByRole('button', { name: 'Search', exact: true });
    const initialSearchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    assert.equal(initialSearchButton().disabled, true, 'submission waits for the initial charts to stop moving the toolbar');
    await user.clear(initialSearchInput);
    await user.type(initialSearchInput, 'seed draft');
    await user.click(initialSearchButton());
    assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'seed');
    await act(async () => { failInitialSummary(new Error('Summary unavailable')); });
    await screen.findByRole('alert');
    assert.equal(initialSearchButton().disabled, false, 'a failed initial summary does not lock search');
    assert.equal(initialSearchInput.value, 'seed draft', 'loading and failure retain the editable draft');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => assert.equal(initialSearchButton().disabled, false));
    assert.equal(initialSearchInput.value, 'seed draft', 'ready summary retains the draft');
    await user.clear(initialSearchInput);
    await user.type(initialSearchInput, 'seed');
    const toolbar = () => [...dom.window.document.querySelectorAll('.analytics-table-controls')];
    assert.equal(toolbar().length, 1);
    assert.ok(toolbar()[0].closest('.report-table-panel'), 'date/search controls belong to the active report table card');
    assert.equal(screen.getAllByRole('textbox', { name: 'Search business analytics' }).length, 1);

    const dateString = (value) => value.toISOString().slice(0, 10);
    const expectedEnd = dateString(new Date());
    const expectedStart = dateString(new Date(Date.parse(`${expectedEnd}T00:00:00.000Z`) - 6 * 86_400_000));
    const editedStart = dateString(new Date(Date.parse(`${expectedStart}T00:00:00.000Z`) + 86_400_000));
    assert.equal(screen.getByLabelText('Start date').value, expectedStart, 'a legacy 7-day period shows its inclusive start date');
    assert.equal(screen.getByLabelText('End date').value, expectedEnd, 'a legacy 7-day period shows today as its end date');
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' && url.searchParams.get('days') === '7')));

    await user.clear(screen.getByLabelText('Start date'));
    await user.type(screen.getByLabelText('Start date'), editedStart);
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportPeriod'), 'custom');
      assert.equal(params.get('reportStart'), editedStart);
      assert.equal(params.get('reportEnd'), expectedEnd);
      assert.equal(params.get('reportPage'), null, 'page one is implicit rather than persisted');
      assert.equal(params.get('organizationIds'), 'org-a');
      assert.equal(params.get('venueIds'), 'venue-a');
      assert.equal(params.get('reportRegions'), 'Orlando, FL, US');
      assert.equal(params.get('reportTable'), null, 'the default Regions table is implicit');
      assert.equal(params.get('reportSort'), 'events_desc');
    });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' &&
      url.searchParams.get('startDate') === editedStart && url.searchParams.get('endDate') === expectedEnd &&
      url.searchParams.get('organizationIds') === 'org-a' && url.searchParams.get('venueIds') === 'venue-a')));

    await user.clear(screen.getByLabelText('End date'));
    await waitFor(() => assert.ok(screen.getByText(/Choose both dates in order to load a custom paid-order report/i)));
    assert.equal(toolbar().length, 1, 'the controls remain mounted for an incomplete custom range');
    assert.ok(toolbar()[0].closest('.report-table-panel'));
    assert.equal(screen.queryByLabelText('Sales period'), null);
    assert.ok(screen.getByRole('button', { name: 'Reset' }), 'report navigation stays resettable even when dates are incomplete');
    const summaryCount = requests.filter((url) => url.pathname === '/api/business/reports/summary').length;
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(requests.filter((url) => url.pathname === '/api/business/reports/summary').length, summaryCount,
      'an incomplete custom range does not request a report');

    await user.type(screen.getByLabelText('End date'), expectedEnd);
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' &&
      url.searchParams.get('startDate') === editedStart && url.searchParams.get('endDate') === expectedEnd)));

    let searchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    const searchButton = screen.getByRole('button', { name: 'Search' });
    const searchForm = searchInput.closest('form');
    assert.ok(searchForm, 'search input and submit button are in a form so Enter submits the draft');
    assert.ok(searchInput.compareDocumentPosition(searchButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the Search button follows the input in the form, keeping it alongside the input on mobile');
    await new Promise((resolve) => setTimeout(resolve, 280));
    const priorRequests = requests.length;
    await user.clear(searchInput);
    await user.type(searchInput, 'Rew1nd');
    assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'seed',
      'typing edits only the draft and leaves the applied search in the URL');
    assert.equal(new URLSearchParams(dom.window.location.search).get('reportTable'), null,
      'typing on the Regions table leaves its hierarchy level unchanged');
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(requests.length, priorRequests, 'typing a search does not request reports before submission');

    await user.click(searchButton);
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportSearch'), 'Rew1nd');
      assert.equal(params.get('reportStart'), editedStart);
      assert.equal(params.get('reportEnd'), expectedEnd);
      assert.equal(params.get('reportPage'), null);
      assert.equal(params.get('organizationIds'), 'org-a');
      assert.equal(params.get('venueIds'), 'venue-a');
      assert.equal(params.get('reportTable'), 'events');
      assert.equal(params.get('reportSort'), null, 'the default descending sales sort is implicit');
    });
    for (const title of ['Rew1nd Late Night', 'Rew1nd After Hours', 'Rew1nd Sunset Sessions', 'Rew1nd Closing Set']) {
      await screen.findByRole('button', { name: title });
    }
    searchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    assert.equal(screen.getAllByRole('button', { name: /Rew1nd/ }).length, 4,
      'the submitted search displays the four matching event rows directly');
    await waitFor(() => assert.ok(screen.getByText('$67.40'), 'summary totals update to the matching events’ $67.40 sales'));
    await waitFor(() => assert.ok(screen.getByText('20', { selector: 'strong' }), 'summary order count reflects all matching events'));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' &&
      url.searchParams.get('search') === 'Rew1nd' && url.searchParams.get('startDate') === editedStart &&
      url.searchParams.get('endDate') === expectedEnd && url.searchParams.get('organizationIds') === 'org-a' &&
      url.searchParams.get('venueIds') === 'venue-a' && url.searchParams.get('regions') === 'Orlando, FL, US')));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/events' &&
      url.searchParams.get('search') === 'Rew1nd' && url.searchParams.get('page') === '1' &&
      url.searchParams.get('sort') === 'sales_desc' && url.searchParams.get('startDate') === editedStart &&
      url.searchParams.get('endDate') === expectedEnd && url.searchParams.get('organizationIds') === 'org-a' &&
      url.searchParams.get('venueIds') === 'venue-a' && url.searchParams.get('regions') === 'Orlando, FL, US')));

    const requestsAfterLate = requests.length;
    await user.clear(searchInput);
    assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'Rew1nd',
      'clearing the field edits the draft without clearing the applied filter');
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(requests.length, requestsAfterLate, 'clearing an unapplied draft does not request reports');
    await user.type(searchInput, 'early');
    assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'Rew1nd');
    await user.keyboard('{Enter}');
    await waitFor(() => assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'early'));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' &&
      url.searchParams.get('search') === 'early' && url.searchParams.get('startDate') === editedStart &&
      url.searchParams.get('endDate') === expectedEnd && url.searchParams.get('organizationIds') === 'org-a' &&
      url.searchParams.get('venueIds') === 'venue-a')));

    act(() => {
      dom.window.history.pushState({}, '', `/app?section=analytics&reportPeriod=custom&reportStart=${editedStart}&reportEnd=${expectedEnd}&reportTable=events&reportSearch=Rew1nd&reportRegions=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC`);
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'Rew1nd');
      assert.equal(searchInput.value, 'Rew1nd', 'Back restores both the applied search and its visible draft');
    });
    act(() => {
      dom.window.history.pushState({}, '', `/app?section=analytics&reportPeriod=custom&reportStart=${editedStart}&reportEnd=${expectedEnd}&reportTable=events&reportSearch=early&reportRegions=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC`);
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      assert.equal(new URLSearchParams(dom.window.location.search).get('reportSearch'), 'early');
      assert.equal(searchInput.value, 'early', 'Forward restores both the applied search and its visible draft');
    });

    act(() => {
      dom.window.history.pushState({}, '', '/app?section=analytics&reportPeriod=custom&reportStart=2026-09-01&reportEnd=2026-09-30&reportTable=venues&reportPage=3&reportPageSize=10&reportSort=events_desc&reportSearch=seed&reportRegion=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await screen.findByRole('heading', { name: 'Venues & creators' });
    searchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    await user.clear(searchInput);
    await user.type(searchInput, 'Rew1nd');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportSearch'), 'Rew1nd');
      assert.equal(params.get('reportTable'), 'events');
      assert.equal(params.get('reportSort'), null);
      assert.equal(params.get('reportPage'), null);
      assert.equal(params.get('reportRegion'), 'Orlando, FL, US');
      assert.equal(params.get('organizationIds'), 'org-a');
      assert.equal(params.get('venueIds'), 'venue-a');
    });
    await screen.findByRole('button', { name: 'Rew1nd Late Night' });
    searchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/events' &&
      url.searchParams.get('search') === 'Rew1nd' && url.searchParams.get('page') === '1' &&
      url.searchParams.get('sort') === 'sales_desc' && url.searchParams.get('startDate') === '2026-09-01' &&
      url.searchParams.get('endDate') === '2026-09-30' && url.searchParams.get('organizationIds') === 'org-a' &&
      url.searchParams.get('venueIds') === 'venue-a' && url.searchParams.get('regions') === 'Orlando, FL, US')));
    await user.clear(searchInput);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.has('reportSearch'), false);
      assert.equal(params.get('reportTable'), 'events', 'submitting an empty search on Events keeps the Events table active');
    });

    await new Promise((resolve) => setTimeout(resolve, 300)); // Let the applied-search summary debounce settle.
    const summaryRequestCountBeforeNoop = requests.filter((url) => url.pathname === '/api/business/reports/summary').length;
    const activeEventsView = screen.getByRole('button', { name: 'Events', pressed: true });
    await user.click(activeEventsView);
    await user.click(activeEventsView);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(requests.filter((url) => url.pathname === '/api/business/reports/summary').length,
      summaryRequestCountBeforeNoop, 'clicking the active report category repeatedly does not refetch the summary');
    assert.equal(screen.getByRole('button', { name: 'Events', pressed: true }), activeEventsView,
      'the active category control stays mounted after repeated clicks');

    await user.click(screen.getByRole('button', { name: 'Autumn Preview' }));
    await screen.findByRole('heading', { name: 'Tickets and packages' });
    await screen.findByText('General Admission');
    const eventTableCard = screen.getByRole('heading', { name: 'Tickets and packages' }).closest('.report-table-panel');
    const eventBreadcrumb = await screen.findByRole('button', { name: 'Back to event reports' });
    const eventToolbar = eventTableCard.querySelector('.analytics-table-controls');
    assert.ok(eventTableCard.contains(eventBreadcrumb), 'the event breadcrumb is inside the active analytics table card');
    assert.ok(eventToolbar.firstElementChild.contains(eventBreadcrumb.closest('.report-breadcrumb')),
      'the event breadcrumb is inside the first table control, above the date and search controls');
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('section'), 'analytics', 'drilling into an event stays in Analytics');
      assert.equal(params.get('reportEvent'), '00000000-0000-4000-8000-000000000001', 'the selected event is carried as analytics scope');
      assert.equal(params.get('reportTable'), 'offerings', 'the first event detail shows offering performance');
      assert.equal(params.get('reportStart'), '2026-09-01', 'drilling preserves the date range');
      assert.equal(params.get('reportEnd'), '2026-09-30');
      assert.equal(params.get('reportRegion'), 'Orlando, FL, US', 'drilling preserves the region filter');
      assert.equal(params.get('organizationIds'), 'org-a', 'drilling preserves organization scope');
      assert.equal(params.get('venueIds'), 'venue-a', 'drilling preserves venue scope');
      assert.equal(params.get('reportPage'), null, 'event detail starts at its implicit first page');
      assert.equal(params.has('event'), false, 'drilling into analytics never opens event management');
    });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/summary' &&
      url.searchParams.get('eventId') === '00000000-0000-4000-8000-000000000001')));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/offerings' &&
      url.searchParams.get('eventId') === '00000000-0000-4000-8000-000000000001')));

    await user.click(screen.getByRole('button', { name: 'Customers' }));
    await screen.findByRole('heading', { name: 'Customers' });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/customers' &&
      url.searchParams.get('eventId') === '00000000-0000-4000-8000-000000000001')));
    act(() => {
      dom.window.history.pushState({}, '', '/app?section=analytics&reportPeriod=custom&reportStart=2026-09-01&reportEnd=2026-09-30&reportTable=offerings&reportEvent=00000000-0000-4000-8000-000000000001&reportRegion=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportEvent'), '00000000-0000-4000-8000-000000000001', 'browser Back keeps the selected event while restoring its prior table');
      assert.equal(params.get('reportTable'), 'offerings');
    });
    act(() => {
      dom.window.history.pushState({}, '', '/app?section=analytics&reportPeriod=custom&reportStart=2026-09-01&reportEnd=2026-09-30&reportTable=events&reportRegion=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.has('reportEvent'), false, 'browser Back returns to the event list');
      assert.equal(params.get('reportTable'), 'events');
    });
    act(() => {
      dom.window.history.pushState({}, '', '/app?section=analytics&reportPeriod=custom&reportStart=2026-09-01&reportEnd=2026-09-30&reportTable=offerings&reportEvent=00000000-0000-4000-8000-000000000001&reportRegion=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportEvent'), '00000000-0000-4000-8000-000000000001', 'browser Forward restores the selected event');
      assert.equal(params.get('reportTable'), 'offerings');
    });
    act(() => {
      dom.window.history.pushState({}, '', '/app?section=analytics&reportPeriod=custom&reportStart=2026-09-01&reportEnd=2026-09-30&reportTable=customers&reportEvent=00000000-0000-4000-8000-000000000001&reportRegion=Orlando%2C%20FL%2C%20US&organizationIds=org-a&venueIds=venue-a&reportTimezone=UTC');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportEvent'), '00000000-0000-4000-8000-000000000001');
      assert.equal(params.get('reportTable'), 'customers');
    });
    await user.click(await screen.findByRole('button', { name: 'Back to event reports' }));
    await screen.findByRole('heading', { name: 'Events' });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.has('reportEvent'), false, 'returning to the event list clears the event scope');
      assert.equal(params.get('reportTable'), 'events');
      assert.equal(params.get('reportPage'), null);
    });

    await user.click(await screen.findByRole('button', { name: 'Team' }));
    await screen.findByRole('heading', { name: 'Team' });

    searchInput = screen.getByRole('textbox', { name: 'Search business analytics' });
    assert.equal(toolbar().length, 1, 'switching views does not duplicate date/search controls');
    assert.ok(toolbar()[0].closest('.team-performance-panel'), 'date/search controls follow the active Team panel');
    assert.equal(screen.getAllByRole('textbox', { name: 'Search business analytics' }).length, 1);
    assert.equal(screen.queryByRole('textbox', { name: 'Search team performance' }), null,
      'Analytics Team hides the redundant person-only search');
    const teamPanel = screen.getByRole('heading', { name: 'Team' }).closest('.team-performance-panel');
    assert.ok(teamPanel.contains(screen.getByRole('button', { name: 'Export CSV' })), 'Team export is in the report-card header');
    assert.ok(teamPanel.textContent.includes('Sales by referral'));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/team')));
    const teamRequest = [...requests].reverse().find((url) => url.pathname === '/api/business/reports/team');
    assert.equal(teamRequest.searchParams.has('personSearch'), false,
      'legacy reportTeamSearch does not become a second analytics personSearch parameter');
    await user.clear(searchInput);
    await user.type(searchInput, 'Avery');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportSearch'), 'Avery');
      assert.equal(params.get('reportTable'), 'team', 'submitting a search on Team keeps the Team table active');
    });
    await screen.findByRole('heading', { name: 'Team' });

    const exportButton = screen.getByRole('button', { name: 'Export CSV' });
    await user.click(exportButton);
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/export.csv')));
    const exportRequest = requests.find((url) => url.pathname === '/api/business/reports/export.csv');
    assert.equal(exportRequest.searchParams.get('exportTable'), 'team');
    assert.equal(exportRequest.searchParams.get('search'), 'Avery');
    assert.equal(exportButton.disabled, true, 'CSV export is disabled while the request is pending');
    assert.equal(exportButton.textContent.trim(), 'Preparing…', 'the header reflects the pending export');
    finishExport(new Response('Name,Sales\nAvery Promoter,50.00\n', { status: 200, headers: { 'content-type': 'text/csv' } }));
    await waitFor(() => assert.equal(exportButton.disabled, false, 'the export control re-enables after the response completes'));

    await user.click(screen.getAllByRole('button', { name: 'Avery Promoter' })[0]);
    await screen.findByRole('heading', { name: 'Tickets and packages' });
    await screen.findByText('General Admission');
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportPerson'), 'person-1');
      assert.equal(params.get('reportTable'), 'offerings');
      assert.equal(params.get('reportSearch'), 'Avery');
      assert.equal(params.get('reportStart'), '2026-09-01');
      assert.equal(params.get('reportEnd'), '2026-09-30');
      assert.equal(params.get('reportRegion'), 'Orlando, FL, US');
      assert.equal(params.get('organizationIds'), 'org-a');
      assert.equal(params.get('venueIds'), 'venue-a');
    });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/offerings' &&
      url.searchParams.get('personId') === 'person-1' && url.searchParams.get('search') === 'Avery')));
    await user.click(screen.getAllByRole('button', { name: 'General Admission' })[0]);
    await screen.findByRole('heading', { name: 'Customers' });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportPerson'), 'person-1');
      assert.equal(params.get('reportOfferingKind'), 'ticket');
      assert.equal(params.get('reportOfferingName'), 'General Admission');
      assert.equal(params.get('reportTable'), 'customers');
      assert.equal(params.get('reportSearch'), 'Avery');
    });
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/reports/customers' &&
      url.searchParams.get('personId') === 'person-1' && url.searchParams.get('offeringKind') === 'ticket' &&
      url.searchParams.get('offeringName') === 'General Admission')));
    await user.click(screen.getByRole('button', { name: 'Back to team member purchases' }));
    await screen.findByRole('heading', { name: 'Tickets and packages' });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.get('reportPerson'), 'person-1');
      assert.equal(params.has('reportOfferingKind'), false);
      assert.equal(params.has('reportOfferingName'), false);
      assert.equal(params.get('reportSearch'), 'Avery');
    });
    await user.click(screen.getByRole('button', { name: 'Back to team reports' }));
    await screen.findByRole('heading', { name: 'Team' });
    await waitFor(() => {
      const params = new URLSearchParams(dom.window.location.search);
      assert.equal(params.has('reportPerson'), false);
      assert.equal(params.has('reportOfferingKind'), false);
      assert.equal(params.has('reportOfferingName'), false);
      assert.equal(params.get('reportTable'), 'team');
      assert.equal(params.get('reportSearch'), 'Avery');
      assert.equal(params.get('reportStart'), '2026-09-01');
      assert.equal(params.get('reportEnd'), '2026-09-30');
    });
    await user.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    await screen.findByRole('heading', { name: 'Regions', exact: true });
    const resetParams = new URLSearchParams(dom.window.location.search);
    for (const key of ['organizationIds', 'venueIds', 'reportRegion', 'reportRegions', 'reportEvent', 'reportPerson',
      'reportOfferingKind', 'reportOfferingName', 'reportSearch', 'reportTeamSearch', 'reportTable', 'reportSort', 'reportPage']) {
      assert.equal(resetParams.has(key), false, `Reset clears ${key} (defaults stay implicit)`);
    }
    assert.equal(resetParams.get('reportStart'), '2026-09-01');
    assert.equal(resetParams.get('reportEnd'), '2026-09-30');
    assert.equal(screen.getByRole('textbox', { name: 'Search business analytics' }).value, '');
    assert.ok(!within(screen.getByRole('group', { name: 'Analytics report views' })).queryByRole('button', { name: 'Regions', exact: true }),
      'Reset replaces the Regions category button, not the multi-region filter');
    await user.click(screen.getByRole('button', { name: 'Customers', exact: true }));
    await screen.findByRole('heading', { name: 'Customers', exact: true });
    await screen.findByText('Buyer A');
    await waitFor(() => assert.ok(requests.some(url => url.pathname === '/api/business/reports/customers' &&
      !url.searchParams.has('eventId') && !url.searchParams.has('personId') && !url.searchParams.has('offeringName') &&
      !url.searchParams.has('venueIds') && !url.searchParams.has('regions') && url.searchParams.get('startDate') === '2026-09-01')));
    assert.equal(screen.getByRole('button', { name: 'Customers', pressed: true }).textContent, 'Customers');
  } finally {
    finishExport?.(new Response('Name,Sales\n', { status: 200, headers: { 'content-type': 'text/csv' } }));
    try { unmount?.(); } catch {}
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
