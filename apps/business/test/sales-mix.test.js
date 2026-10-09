import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { salesMixSlices } from '../src/lib/sales-mix.js';

test('sales mix chart groups the long tail without losing revenue', () => {
  const rows = [
    { id: 'small', name: 'Small', salesCents: 100 },
    { id: 'large', name: 'Large', salesCents: 500 },
    { id: 'medium', name: 'Medium', salesCents: 300 },
    { id: 'zero', name: 'Unsold', salesCents: 0 },
  ];
  const slices = salesMixSlices(rows, 2);
  assert.deepEqual(slices.map(({ name, salesCents }) => [name, salesCents]), [['Large', 500], ['Medium', 300], ['Other', 100]]);
  assert.equal(slices.reduce((sum, row) => sum + row.salesCents, 0), 900);
  assert.deepEqual(salesMixSlices([{ id: 'zero', name: 'Unsold', salesCents: 0 }]), []);
});

test('sales mix merges a pre-aggregated Other row without duplicate slice ids or lost revenue', () => {
  const rows = [
    { id: 'event-1', name: 'One', salesCents: 600 },
    { id: 'event-2', name: 'Two', salesCents: 500 },
    { id: 'event-3', name: 'Three', salesCents: 400 },
    { id: 'event-4', name: 'Four', salesCents: 300 },
    { id: 'event-5', name: 'Five', salesCents: 200 },
    { id: 'other', name: 'Other events', salesCents: 150 },
    { id: 'event-6', name: 'Six', salesCents: 100 },
    { id: 'event-7', name: 'Seven', salesCents: 90 },
  ];

  const slices = salesMixSlices(rows);
  assert.equal(new Set(slices.map((row) => row.id)).size, slices.length, 'every chart slice has a unique React key');
  assert.equal(slices.filter((row) => row.name === 'Other').length, 1);
  assert.equal(slices.find((row) => row.name === 'Other').salesCents, 240);
  assert.equal(slices.reduce((sum, row) => sum + row.salesCents, 0), rows.reduce((sum, row) => sum + row.salesCents, 0));
});

test('sales mix keeps a real offering named Other separate from synthetic Other revenue', () => {
  const rows = [
    { id: 'ticket:one', name: 'One', salesCents: 1000 },
    { id: 'ticket:two', name: 'Two', salesCents: 900 },
    { id: 'ticket:three', name: 'Three', salesCents: 800 },
    { id: 'ticket:four', name: 'Four', salesCents: 700 },
    { id: 'ticket:five', name: 'Five', salesCents: 600 },
    { id: 'ticket:Other', name: 'Other', salesCents: 550 },
    { id: 'ticket:six', name: 'Six', salesCents: 500 },
    { id: 'other', name: 'Other', salesCents: 400 },
  ];

  const slices = salesMixSlices(rows);
  assert.equal(new Set(slices.map((row) => row.id)).size, slices.length);
  assert.deepEqual(slices.filter((row) => row.name === 'Other').map(({ id, salesCents }) => ({ id, salesCents })), [
    { id: 'ticket:Other', salesCents: 550 },
    { id: 'other', salesCents: 900 },
  ]);
  assert.equal(slices.reduce((sum, row) => sum + row.salesCents, 0), rows.reduce((sum, row) => sum + row.salesCents, 0));
  const overviewAdapter = readFileSync(new URL('../src/components/BusinessOverview.jsx', import.meta.url), 'utf8');
  assert.match(overviewAdapter, /id: row\.kind === 'other' \? 'other' : row\.kind \+ ':' \+ row\.label/);
});

test('event sales mix keeps each event date with its chart slice', () => {
  const [event] = salesMixSlices([{ id: 'event-1', name: 'Friday Night', dateLabel: '09/26/2026', salesCents: 500 }]);
  assert.equal(event.dateLabel, '09/26/2026');
  assert.equal(event.name, 'Friday Night');
});

test('Overview event sales mix displays venue-local dates while names can truncate on narrow screens', () => {
  const overview = readFileSync(new URL('../src/components/OverviewPresentation.jsx', import.meta.url), 'utf8');
  const chart = readFileSync(new URL('../src/components/SalesMixPie.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(overview, /eventDates = new Map\(data\.events\.map\(\(event\) => \[event\.id, eventDateLabel\(event\)\]\)\)/);
  assert.match(overview, /dateLabel: eventDates\.get\(event\.id\)/);
  assert.match(overview, /className="revenue-chart"[\s\S]*?<AreaChart/);
  assert.match(overview, /className="panel revenue-panel"[\s\S]*?className="revenue-chart"/);
  assert.match(overview, /className="panel breakdown-panel"/);
  assert.match(chart, /mix-legend-date/);
  assert.match(css, /\.rank-title-name \{[^}]*text-overflow: ellipsis;/);
  assert.match(css, /\.event-sales-mix \.mix-legend \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('Overview switches from Tickets & packages to Events with unique sales mix keys and no React warnings', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
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
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const originalConsoleError = console.error;
  const reactWarnings = [];
  console.error = (...args) => {
    if (args.some((arg) => /same key|unique "key" prop/i.test(String(arg)))) reactWarnings.push(args.join(' '));
    originalConsoleError(...args);
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { OverviewPresentation } = await vite.ssrLoadModule('/src/components/OverviewPresentation.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const packageSales = [840, 740, 640, 540, 440, 340, 270, 230];
    const packages = packageSales.map((salesCents, index) => ({ id: `package-${index}`, name: `Package ${index + 1}`, salesCents, units: index + 1 }));
    const events = [
      ...Array.from({ length: 5 }, (_, index) => ({ id: `event-${index + 1}`, name: `Event ${index + 1}`, salesCents: 900 - index * 100, orders: index + 1 })),
      { id: 'other', name: 'Other events', salesCents: 350, orders: 3 },
      { id: 'event-6', name: 'Event 6', salesCents: 100, orders: 1 },
      { id: 'event-7', name: 'Event 7', salesCents: 90, orders: 1 },
    ];
    const view = render(React.createElement(OverviewPresentation, { data: {
      report: {
        summary: { salesCents: 4040, orders: 8, checkedIn: 0, admissions: 0, guestlistPlaces: 0, commissionCents: 0 },
        daily: [], packages, events, people: [],
      },
      events: [], range: { days: 30 },
    } }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await screen.findByRole('img', { name: /sales mix by face-value revenue/i });
    assert.equal(screen.getAllByText('Other').length, 1, 'package mix groups its long tail into one Other slice');
    await user.click(screen.getByRole('tab', { name: 'Events' }));
    await waitFor(() => assert.match(screen.getByRole('img', { name: /sales mix by face-value revenue/i }).getAttribute('aria-label'), /Other \$4\.40/));
    assert.equal(screen.getAllByText('Other').length, 1, 'the event legend renders one merged Other row');
    assert.deepEqual(reactWarnings, []);
  } finally {
    try { unmount?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (vite) await vite.close();
    console.error = originalConsoleError;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
