import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('shared report tables and team performance fetch real second pages and persist page size', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/app?section=analytics', pretendToBeVisual: true });
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
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const oldFetch = globalThis.fetch;
  const requests = [];
  const eventRows = Array.from({ length: 19 }, (_, i) => ({ id: String(i + 1), eventId: String(i + 1), label: `Event ${i + 1}`, orders: i + 1, salesCents: (i + 1) * 100 }));
  const people = Array.from({ length: 16 }, (_, i) => ({ id: String(i + 1), label: `Member ${i + 1}`, role: 'Employee', orders: i + 1, salesCents: (i + 1) * 100,
    commissionCents: 0, guestlistPlaces: 0, approvedGuestlistPlaces: 0 }));
  globalThis.fetch = async (input) => { const url = new URL(String(input), dom.window.location.href); requests.push(url);
    const all = url.pathname.endsWith('/team') ? people : eventRows;
    const page = Number(url.searchParams.get('page')); const pageSize = Number(url.searchParams.get('pageSize'));
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return new Response(JSON.stringify({ data: { items, total: all.length, page, pageSize, hasMore: page * pageSize < all.length,
      range: { timezone: 'America/New_York' } } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  let vite; let unmount;
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: resolve(root, 'vite.config.js'), root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessReportTable } = await vite.ssrLoadModule('/src/components/BusinessReportTables.jsx');
    const { BusinessTeamPerformance } = await vite.ssrLoadModule('/src/components/BusinessTeamPerformance.jsx');
    const React = await import('react');
    const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    let reportPage = 1; let reportPageSize = 10;
    function Report() { const [page, setPage] = React.useState(reportPage); const [size, setSize] = React.useState(reportPageSize);
      return React.createElement(BusinessReportTable, { kind: 'events', session: { accessToken: 'fixture' }, query: '',
        initialPage: page, pageSize: size, onUnauthorized() {}, onPageChange(value) { reportPage = value; setPage(value); },
        onPageSizeChange(value) { reportPageSize = value; reportPage = 1; setPage(1); setSize(value); } }); }
    let view = render(React.createElement(Report), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /1–10 of 19 events · Page 1 of 2/));
    assert.equal(requests.at(-1).searchParams.get('pageSize'), '10');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /11–19 of 19 events · Page 2 of 2/));
    assert.equal(requests.at(-1).searchParams.get('page'), '2');
    assert.match(screen.getByRole('table').textContent, /Event 19/);
    assert.doesNotMatch(screen.getByRole('table').textContent, /Event 1\b/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /1–19 of 19 events · Page 1 of 1/));
    assert.equal(requests.at(-1).searchParams.get('pageSize'), '25');
    assert.equal(screen.getByRole('button', { name: 'Next' }).disabled, true);
    unmount(); cleanup();
    dom.window.history.replaceState({}, '', '/app');

    view = render(React.createElement(BusinessTeamPerformance, { session: { accessToken: 'fixture' }, query: '',
      totalSales: 20000, directSalesCents: 0, revision: 0, onUnauthorized() {}, onEvents() {} }),
    { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /1–10 of 16 team members · Page 1 of 2/));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => assert.match(screen.getByRole('status').textContent, /11–16 of 16 team members · Page 2 of 2/));
    assert.equal(requests.at(-1).searchParams.get('page'), '2');
    assert.equal(dom.window.location.search.includes('overviewTeamPage=2'), true);
    assert.match(screen.getAllByRole('table')[0].textContent, /Member 16/);
    assert.doesNotMatch(screen.getAllByRole('table')[0].textContent, /Member 1\b/);
  } finally {
    try { unmount?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (vite) await vite.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
