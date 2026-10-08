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
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLFormElement: dom.window.HTMLFormElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view, refresh;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { PreparedExports } = await vite.ssrLoadModule('/src/components/PreparedExports.jsx');
    const { useReportExportSession } = await vite.ssrLoadModule('/src/hooks/useReportExportSession.js');
    const { useReportDownload } = await vite.ssrLoadModule('/src/hooks/useReportDownload.js');
    const { reportExportIdentity } = await vite.ssrLoadModule('/src/lib/report-export-session.js');
    const React = await import('react');
    const { render, screen, act, fireEvent, waitFor } = await import('@testing-library/react');
    const session = { accessToken: 'first-session' };
    function Initiator({ session, audience }) {
      const { download, exporting, error } = useReportDownload(session, { audience });
      return React.createElement('div', null,
        React.createElement('button', { onClick: () => download('days=30'), disabled: exporting }, exporting ? 'Preparing export' : 'Start export'),
        error && React.createElement('p', { role: 'alert' }, error));
    }
    function ExportWorkspace({ showExports = true, showInitiator = false, ...props }) {
      useReportExportSession(props.session, props.audience);
      return React.createElement(React.Fragment, null,
        showInitiator && React.createElement(Initiator, props),
        showExports && React.createElement(PreparedExports, props));
    }
    const nativeInterval = globalThis.setInterval;
    t.mock.method(globalThis, 'setInterval', (callback, duration, ...args) => {
      if (duration !== 15000) return nativeInterval(callback, duration, ...args);
      refresh = callback;
      return 0;
    });
    const mount = (request, extra = {}) => {
      view?.unmount();
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      view = render(React.createElement(ExportWorkspace, { session, request, ...extra }), { container: dom.window.document.getElementById('root') });
      return view;
    };
    const progress = async (job, audience = 'business') => act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent('nitewide:export-progress', { detail: { ...job, audience, identity: reportExportIdentity(session, audience) } }));
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
      view.rerender(React.createElement(ExportWorkspace, { session: null, request }));
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
      view.rerender(React.createElement(ExportWorkspace, { session, request, audience: 'admin' }));
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
        view.rerender(React.createElement(ExportWorkspace, { session: { accessToken: 'second-session' }, request }));
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

    await t.test('account changes and logout cancel prepared downloads and reject late progress from the previous identity', async subtest => {
      const saved = [];
      subtest.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { saved.push(this.download); });
      for (const audience of ['business', 'admin']) {
        for (const next of [{ accessToken: 'second-session' }, { accessToken: 'first-session', user: { id: 'another-person' } }, null]) {
          const pending = deferred(), calls = [];
          const request = async (_path, identity) => identity === session ? [ready] : [];
          subtest.mock.method(globalThis, 'fetch', (url, options) => { calls.push({ url, options }); return pending.promise; });
          mount(request, { audience });
          await act(async () => {});
          const oldIdentity = reportExportIdentity(session, audience);
          fireEvent.click(screen.getByRole('button', { name: 'Download', hidden: true }));
          assert.equal(calls.length, 1);
          view.rerender(React.createElement(ExportWorkspace, { session: next, request, audience }));
          assert.equal(calls[0].options.signal.aborted, true);
          await act(async () => {
            pending.resolve(new Response('old-session report'));
            dom.window.dispatchEvent(new dom.window.CustomEvent('nitewide:export-progress', { detail: { ...rendering, audience, identity: oldIdentity } }));
            dom.window.dispatchEvent(new dom.window.CustomEvent('nitewide:export-progress', { detail: { ...rendering, audience } }));
          });
          assert.equal(screen.queryByTestId('prepared-exports'), null);
          assert.equal(screen.queryByRole('alert', { hidden: true }), null);
          assert.equal(saved.length, 0);
          assert.equal(calls.length, 1);
        }
      }
    });

    await t.test('initiating export controls ignore old errors and reset busy state for a new session', async subtest => {
      const pending = [];
      subtest.mock.method(globalThis, 'fetch', (_url, options) => { const call = deferred(); pending.push({ ...call, options }); return call.promise; });
      const request = async () => [];
      mount(request, { showInitiator: true });
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      assert.ok(screen.getByRole('button', { name: 'Preparing export' }).disabled);
      view.rerender(React.createElement(ExportWorkspace, { session: { accessToken: 'second-session' }, request, showInitiator: true }));
      assert.equal(pending[0].options.signal.aborted, true);
      assert.equal(screen.getByRole('button', { name: 'Start export' }).disabled, false);
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      await act(async () => pending[0].resolve(Response.json({ error: { message: 'Old account access expired' } }, { status: 401 })));
      assert.equal(screen.queryByRole('alert'), null);
      assert.ok(screen.getByRole('button', { name: 'Preparing export' }).disabled, 'an old finally callback cannot clear the new operation');
      await act(async () => pending[1].resolve(Response.json({ error: { message: 'Current export unavailable' } }, { status: 503 })));
      assert.equal(screen.getByRole('alert').textContent, 'Current export unavailable');
      assert.equal(screen.getByRole('button', { name: 'Start export' }).disabled, false);
    });

    await t.test('logout and re-entry with the same credential still rejects progress from the previous workspace lifetime', async () => {
      const request = async () => [];
      mount(request);
      await act(async () => {});
      const previousIdentity = reportExportIdentity(session);
      view.rerender(React.createElement(ExportWorkspace, { session: null, request }));
      view.rerender(React.createElement(ExportWorkspace, { session, request }));
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.CustomEvent('nitewide:export-progress', { detail: { ...rendering, audience: 'business', identity: previousIdentity } }));
      });
      assert.notEqual(reportExportIdentity(session), previousIdentity);
      assert.equal(screen.queryByTestId('prepared-exports'), null);
      await progress(rendering);
      assert.equal(screen.getByRole('status', { hidden: true }).textContent, 'Preparing · 45%');
    });

    await t.test('returning to a former identity before its abort settles cannot revive old busy or error state', async subtest => {
      const pending = [];
      subtest.mock.method(globalThis, 'fetch', (_url, options) => { const call = deferred(); pending.push({ ...call, options }); return call.promise; });
      const request = async () => [];
      const first = { session, request, showInitiator: true };
      const second = { ...first, session: { accessToken: 'second-session' } };
      mount(request, { showInitiator: true });
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      assert.ok(screen.getByRole('button', { name: 'Preparing export' }).disabled);
      view.rerender(React.createElement(ExportWorkspace, second));
      view.rerender(React.createElement(ExportWorkspace, first));
      assert.equal(pending[0].options.signal.aborted, true);
      assert.equal(screen.getByRole('button', { name: 'Start export' }).disabled, false, 'old busy state stays retired even before its promise resumes');
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      await act(async () => pending[0].reject(new Error('Old identity export failed')));
      assert.equal(screen.queryByRole('alert'), null);
      assert.ok(screen.getByRole('button', { name: 'Preparing export' }).disabled);
      await act(async () => pending[1].resolve(Response.json({ error: { message: 'First lifetime error' } }, { status: 503 })));
      assert.equal(screen.getByRole('alert').textContent, 'First lifetime error');
      view.rerender(React.createElement(ExportWorkspace, second));
      view.rerender(React.createElement(ExportWorkspace, first));
      assert.equal(screen.queryByRole('alert'), null, 'an earlier identity lifetime error does not reappear on return');
      assert.equal(screen.getByRole('button', { name: 'Start export' }).disabled, false);
      await act(async () => {});
    });

    await t.test('same-session section navigation preserves an initiated export download', async subtest => {
      const pending = deferred(), saved = [];
      let signal;
      subtest.mock.method(globalThis, 'fetch', (_url, options) => { signal = options.signal; return pending.promise; });
      subtest.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { saved.push(this.download); });
      const request = async () => [];
      mount(request, { showInitiator: true });
      await act(async () => {});
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      view.rerender(React.createElement(ExportWorkspace, { session: { ...session }, request, showExports: false }));
      assert.equal(signal.aborted, false);
      await act(async () => pending.resolve(new Response('current-session CSV')));
      assert.equal(saved.length, 1);
      assert.match(saved[0], /^nitewide-business-/);
    });

    await t.test('the Business shell ignores a second old logout response after another account signs in and starts a download', async subtest => {
      const { default: BusinessApp } = await vite.ssrLoadModule('/src/App.jsx');
      const { downloadPreparedExport } = await vite.ssrLoadModule('/src/lib/report-client.js');
      const { SESSION_KEY } = await vite.ssrLoadModule('/src/lib/api.js');
      const first = { accessToken: 'first-shell-session', expiresAt: new Date(Date.now() + 3600000).toISOString(), user: { id: 'first-shell-user', displayName: 'First User', email: 'first@example.test' }, roles: [] };
      const second = { ...first, accessToken: 'second-shell-session', user: { id: 'second-shell-user', displayName: 'Second User', email: 'second@example.test' } };
      const logout = [deferred(), deferred()], blobs = [deferred(), deferred()], entered = [deferred(), deferred()];
      const saved = [], downloads = [];
      let logoutCalls = 0;
      dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      dom.window.history.replaceState(null, '', '/app?section=events');
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(first));
      subtest.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { saved.push(this.download); });
      subtest.mock.method(globalThis, 'fetch', async (path, options = {}) => {
        if (path === '/api/auth/logout') return logout[logoutCalls++].promise;
        if (path === '/api/auth/business/sign-in') return Response.json({ data: second });
        if (path.endsWith('/download')) {
          const index = downloads.length; downloads.push(options);
          return { ok: true, status: 200, blob: () => { entered[index].resolve(); return blobs[index].promise; } };
        }
        const data = path === '/api/business/bootstrap' ? { organizations: [], venues: [], events: [], setupProgress: [], capabilities: {}, scope: { canCreateIndependent: true } }
          : path === '/api/business/reports/exports' ? [] : { items: [], total: 0, unreadCount: 0, page: 1, pageSize: 20, hasMore: false };
        return Response.json({ data });
      });
      view?.unmount();
      dom.window.document.body.innerHTML = '<div id="root"></div>';
      view = render(React.createElement(BusinessApp), { container: dom.window.document.getElementById('root') });
      await screen.findByRole('heading', { name: 'Every event. The whole picture.' });
      const oldDownload = downloadPreparedExport(first, 'first-job', 'first.csv');
      const oldCancelled = assert.rejects(oldDownload, { name: 'AbortError' });
      await entered[0].promise;
      fireEvent.click(screen.getByRole('button', { name: 'Sign out', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign out', exact: true }));
      assert.equal(logoutCalls, 2);
      await act(async () => logout[0].resolve(Response.json({ data: {} })));
      await oldCancelled;
      fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'second@example.test' } });
      fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'fixture-password' } });
      fireEvent.submit(screen.getByRole('form', { name: 'Business sign in' }));
      await screen.findByRole('button', { name: 'Export report' });
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Export report' }).disabled, false));
      const newDownload = downloadPreparedExport(second, 'second-job', 'second.csv');
      await entered[1].promise;
      await act(async () => logout[1].resolve(Response.json({ error: { message: 'First account already logged out' } }, { status: 401 })));
      assert.equal(JSON.parse(sessionStorage.getItem(SESSION_KEY)).accessToken, second.accessToken);
      assert.equal(downloads[1].signal.aborted, false);
      assert.ok(screen.getByRole('button', { name: 'Export report' }));
      await act(async () => { blobs[0].resolve(new Blob(['old CSV'])); blobs[1].resolve(new Blob(['current CSV'])); await newDownload; });
      assert.deepEqual(saved, ['second.csv']);
      sessionStorage.removeItem(SESSION_KEY);
    });
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
