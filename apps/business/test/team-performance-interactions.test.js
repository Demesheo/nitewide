import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('team performance requests and renders sales in the direction shown by its sort control', async () => {
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
  const priorFetch = globalThis.fetch;
  const requests = [];
  const people = [
    { id: '4', label: 'Zoe Highest', role: 'Promoter', salesCents: 1700 },
    { id: '3', label: 'Maya Mid', role: 'Promoter', salesCents: 1360 },
    { id: '2', label: 'Leo Low', role: 'Promoter', salesCents: 1094 },
    { id: '1', label: 'Zero Seller', role: 'Employee', salesCents: 0 },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), dom.window.location.href);
    requests.push(url);
    const rows = [...people].sort((a, b) => url.searchParams.get('sort') === 'sales_asc'
      ? a.salesCents - b.salesCents || a.id.localeCompare(b.id)
      : b.salesCents - a.salesCents || a.id.localeCompare(b.id));
    return new Response(JSON.stringify({ data: { items: rows, total: rows.length, page: 1, pageSize: 20, hasMore: false } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessTeamPerformance } = await vite.ssrLoadModule('/src/components/BusinessTeamPerformance.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const view = render(React.createElement(BusinessTeamPerformance, {
      session: { accessToken: 'fixture-token' }, query: '', totalSales: 5000, directSalesCents: 0,
      revision: 0, onUnauthorized() {}, onEvents() {},
    }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    const heading = screen.getByRole('heading', { name: 'Team performance', exact: true });
    const header = heading.closest('.analytics-report-header');
    assert.ok(header, 'Overview uses the same two-column header layout as Analytics');
    assert.equal(screen.getByRole('button', { name: 'Export CSV', exact: true }).parentElement, header,
      'Export CSV occupies the upper-right header slot');
    assert.equal(header.querySelector('[aria-label="Roles"]'), null,
      'the role filter is below the header, not competing with its export action');

    const getRenderedOrder = () => [...screen.getAllByRole('table')[0].querySelectorAll('tbody tr')]
      .map((row) => (row.cells[0].querySelector('.performance-name') || row.cells[0]).textContent.replace(/\s+/g, ' ').trim());
    await waitFor(() => assert.equal(getRenderedOrder().length, 4));
    assert.equal(requests.at(-1).searchParams.get('sort'), 'sales_desc', 'the default down-arrow state requests descending sales');
    assert.deepEqual(getRenderedOrder(), ['Zoe Highest', 'Maya Mid', 'Leo Low', 'Zero Seller']);

    await user.click(screen.getAllByRole('button', { name: /Attributed sales/ })[0]);
    await waitFor(() => assert.equal(requests.at(-1).searchParams.get('sort'), 'sales_asc'));
    await waitFor(() => assert.deepEqual(getRenderedOrder(), ['Zero Seller', 'Leo Low', 'Maya Mid', 'Zoe Highest']));

    await user.click(screen.getAllByRole('button', { name: /Attributed sales/ })[0]);
    await waitFor(() => assert.equal(requests.at(-1).searchParams.get('sort'), 'sales_desc'));
    await waitFor(() => assert.deepEqual(getRenderedOrder(), ['Zoe Highest', 'Maya Mid', 'Leo Low', 'Zero Seller']));
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
