import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './helpers/vite-server.js';

const queued = { id: 'export-job', status: 'queued', progress: 0, totalRows: 1200, filename: 'customers.csv' };
const rendering = { ...queued, status: 'rendering', progress: 45 };
const ready = { ...queued, status: 'ready', progress: 100 };
const failed = { ...queued, status: 'failed', error: 'Export failed; please retry.' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('prepared exports keep progress current and isolate asynchronous work by session', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view, refresh;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { PreparedExports } = await vite.ssrLoadModule('/src/components/PreparedExports.jsx');
    const React = await import('react');
    const { render, screen, act, fireEvent } = await import('@testing-library/react');
    const session = { accessToken: 'first-session' };
    const nativeInterval = globalThis.setInterval;
    t.mock.method(globalThis, 'setInterval', (callback, duration, ...args) => {
      if (duration !== 15000) return nativeInterval(callback, duration, ...args);
      refresh = callback;
      return 0;
    });
    const mount = (request, extra = {}) => {
      view?.unmount();
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      view = render(React.createElement(PreparedExports, { session, request, ...extra }), { container: dom.window.document.getElementById('root') });
      return view;
    };
    const progress = async (job, audience = 'business') => act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent('nitewide:export-progress', { detail: { ...job, audience } }));
    });

    await t.test('a pre-export list response cannot erase a job announced while that request was pending', async () => {
      const initial = deferred();
      mount(() => initial.promise);
      await progress(queued);
      assert.ok(screen.getByTestId('prepared-exports'));
      await act(async () => initial.resolve([]));
      assert.ok(screen.getByTestId('prepared-exports'));
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Queued…');
    });

    await t.test('an in-flight refresh preserves newer rendering progress but subsequent snapshots remain authoritative', async () => {
      const pending = [];
      mount(() => { const call = deferred(); pending.push(call); return call.promise; });
      await act(async () => pending[0].resolve([queued]));
      await act(async () => { refresh(); });
      await progress(rendering);
      const other = { ...ready, id: 'older-job', filename: 'events.csv' };
      await act(async () => pending[1].resolve([queued, other]));
      assert.equal(screen.getAllByRole('status', { hidden: true })[0].textContent, 'Preparing · 45%');
      assert.ok(screen.getByText('events.csv'));
      await act(async () => { refresh(); });
      await act(async () => pending[2].resolve([ready]));
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, '1,200 rows · Ready');
      assert.equal(screen.queryByText('events.csv'), null);
      await act(async () => { refresh(); });
      await act(async () => pending[3].resolve([]));
      assert.ok(screen.queryByTestId('prepared-exports') === null, 'expired or no-longer-visible jobs leave on a fresh snapshot');
    });

    await t.test('list requests finishing out of order cannot restore an older status', async () => {
      const pending = [];
      mount(() => { const call = deferred(); pending.push(call); return call.promise; });
      await act(async () => { refresh(); });
      await act(async () => pending[1].resolve([ready]));
      await act(async () => pending[0].resolve([queued]));
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, '1,200 rows · Ready');
    });

    await t.test('malformed initial and background snapshots preserve progress and recover on a valid list', async () => {
      for (const malformed of [{}, null]) {
        const initial = deferred();
        let value = malformed, lists = 0;
        mount(() => ++lists === 1 ? initial.promise : Promise.resolve(value));
        await progress(rendering);
        await act(async () => initial.resolve(malformed));
        assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Preparing · 45%');
        await act(async () => { refresh(); });
        assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Preparing · 45%');
        assert.ok(screen.queryByRole('alert', { hidden: true }) === null);
        value = [ready];
        await act(async () => { refresh(); });
        assert.equal(screen.getByRole('status', { hidden: true }).textContent, '1,200 rows · Ready');
      }
    });

    await t.test('session removal clears jobs and late list responses remain ignored', async () => {
      const pending = [];
      const request = () => { const call = deferred(); pending.push(call); return call.promise; };
      mount(request);
      await act(async () => pending[0].resolve([ready]));
      await act(async () => { refresh(); });
      view.rerender(React.createElement(PreparedExports, { session: null, request }));
      assert.ok(screen.queryByTestId('prepared-exports') === null);
      await act(async () => pending[1].resolve([ready]));
      assert.ok(screen.queryByTestId('prepared-exports') === null);
    });

    await t.test('audience switches reject old list responses and progress from the other workspace', async () => {
      const pending = [];
      const request = (path, identity) => { const call = deferred(); pending.push({ ...call, path, identity }); return call.promise; };
      mount(request);
      await progress(queued, 'admin');
      assert.ok(screen.queryByTestId('prepared-exports') === null);
      view.rerender(React.createElement(PreparedExports, { session, request, audience: 'admin' }));
      assert.equal(pending[1].path, '/admin/reports/exports');
      await progress(rendering, 'business');
      await act(async () => pending[0].resolve([ready]));
      assert.ok(screen.queryByTestId('prepared-exports') === null);
      await act(async () => pending[1].resolve([{ ...ready, filename: 'admin.csv' }]));
      assert.ok(screen.getByText('admin.csv'));
      assert.equal(screen.queryByText('customers.csv'), null);
    });

    await t.test('late retry results cannot populate another session, report an old error, or issue old-session requests', async () => {
      for (const outcome of ['success', 'failure']) {
        const retry = deferred();
        const calls = [];
        const request = async (path, identity, options = {}) => {
          calls.push({ path, identity, options });
          if (options.method === 'POST') return retry.promise;
          return identity === session ? [failed] : [];
        };
        mount(request);
        await act(async () => {});
        fireEvent.click(screen.getByRole('button', { name: 'Retry', hidden: true }));
        assert.equal(screen.getByRole('button', { name: 'Retry', hidden: true }).disabled, true);
        view.rerender(React.createElement(PreparedExports, { session: { accessToken: 'second-session' }, request }));
        await act(async () => outcome === 'success' ? retry.resolve(queued) : retry.reject(new Error('Old session expired')));
        assert.ok(screen.queryByTestId('prepared-exports') === null);
        assert.ok(screen.queryByRole('alert', { hidden: true }) === null);
        assert.equal(calls.filter(call => call.identity === session).length, 2, 'only the original list and retry use the previous session');
      }
    });

    await t.test('failed exports can retry after an error, and retry refreshes keep newer progress', async () => {
      const snapshot = deferred();
      let retries = 0, lists = 0;
      const request = async (path, identity, options = {}) => {
        assert.equal(identity, session);
        if (options.method === 'POST') {
          assert.equal(path, '/business/reports/exports/export-job/retry');
          if (++retries === 1) throw new Error('Retry unavailable');
          return queued;
        }
        assert.equal(path, '/business/reports/exports');
        return ++lists === 1 ? [failed] : snapshot.promise;
      };
      mount(request);
      await act(async () => {});
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, failed.error);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry', hidden: true })));
      assert.equal(screen.getByRole('alert', { hidden: true }).textContent, 'Retry unavailable');
      assert.equal(screen.getByRole('button', { name: 'Retry', hidden: true }).disabled, false);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry', hidden: true })));
      assert.ok(screen.queryByRole('alert', { hidden: true }) === null);
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Queued…');
      await progress(rendering);
      await act(async () => snapshot.resolve([queued]));
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Preparing · 45%');
      assert.equal(retries, 2);
      assert.equal(lists, 2);
    });

    await t.test('malformed retry snapshots surface a recoverable error without erasing newer progress', async () => {
      for (const malformed of [{}, null]) {
        const snapshot = deferred();
        let lists = 0;
        mount(async (_path, _identity, options = {}) => {
          if (options.method === 'POST') return queued;
          return ++lists === 1 ? [failed] : snapshot.promise;
        });
        await act(async () => {});
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry', hidden: true })));
        await progress(rendering);
        await act(async () => snapshot.resolve(malformed));
        assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Preparing · 45%');
        assert.equal(screen.getByRole('alert', { hidden: true }).textContent, 'Unable to load prepared exports. Please try again.');
      }
    });

    await t.test('prepared downloads use the current audience and session and remain retryable after rejection', async subtest => {
      const calls = [], saved = [];
      let downloads = 0;
      subtest.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        if (++downloads === 1) return Response.json({ error: { message: 'Access changed' } }, { status: 403 });
        return new Response('Customer,Sales\r\nJordan,25\r\n', { headers: { 'Content-Type': 'text/csv' } });
      });
      subtest.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { saved.push({ href: this.href, filename: this.download }); });
      mount(async () => [ready], { audience: 'admin' });
      await act(async () => {});
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download', hidden: true })));
      assert.equal(screen.getByRole('alert', { hidden: true }).textContent, 'Access changed');
      assert.equal(screen.getByRole('button', { name: 'Download', hidden: true }).disabled, false);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download', hidden: true })));
      assert.ok(screen.queryByRole('alert', { hidden: true }) === null);
      assert.deepEqual(calls.map(call => call.url), ['/api/admin/reports/exports/export-job/download', '/api/admin/reports/exports/export-job/download']);
      assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer first-session'));
      assert.deepEqual(saved.map(value => value.filename), ['customers.csv']);
      assert.match(saved[0].href, /^blob:/);
    });
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
