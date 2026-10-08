import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCsv, downloadBusinessReport, downloadPreparedExport } from '../src/lib/report-client.js';
import { releaseReportExportSession, setReportExportSession } from '../src/lib/report-export-session.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function downloadBrowser(t) {
  const keys = ['window', 'document', 'fetch', 'CustomEvent'];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const downloads = [], progress = [];
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { dispatchEvent: (event) => progress.push(event.detail) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() { downloads.push(this.download); } }) } });
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    if (ms !== 2500) return timeout(callback, ms, ...args);
    queueMicrotask(callback); return 0;
  });
  return { downloads, progress };
}

test('prepared CSV falls back when browser activation expires, but respects picker cancellation', async (t) => {
  const saved = new Map(['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const links = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const link = { click() { links.push(this); } }; return link;
  } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    showSaveFilePicker: async () => { throw new DOMException('User activation expired', 'SecurityError'); },
  } });
  await saveCsv(new Response('Customer,Sales\r\nJordan,25\r\n'), 'report.csv');
  assert.equal(links.length, 1); assert.equal(links[0].download, 'report.csv');
  assert.match(links[0].href, /^blob:/);
  globalThis.window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  await saveCsv(new Response('Customer,Sales'), 'cancelled.csv');
  assert.equal(links.length, 1, 'cancelling never starts an unwanted fallback download');
});

test('admin prepared exports poll and download only the admin namespace', async (t) => {
  const descriptors = new Map(['window', 'document', 'fetch', 'CustomEvent'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const paths = []; const progress = []; const downloads = [];
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event) => progress.push(event.detail) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() { downloads.push(this.download); } }) } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
    paths.push(url); assert.equal(options.headers.Authorization, 'Bearer token');
    if (url.includes('export.csv?')) return Response.json({ data: { id: 'job', status: 'queued' } }, { status: 202 });
    if (url.endsWith('/download')) return new Response('Customer,Sales\r\nJordan,25\r\n');
    return Response.json({ data: { id: 'job', status: 'ready', filename: 'admin-report.csv' } });
  } });
  await downloadBusinessReport({ accessToken: 'token' }, 'exportTable=purchases', { audience: 'admin' });
  assert.deepEqual(paths, ['/api/admin/reports/export.csv?exportTable=purchases', '/api/admin/reports/exports/job', '/api/admin/reports/exports/job/download']);
  assert.equal(progress.at(-1).audience, 'admin'); assert.deepEqual(downloads, ['admin-report.csv']);
  assert.match(progress.at(-1).identity, /^report-session-/);
  assert.equal(JSON.stringify(progress).includes('token'), false, 'progress identity never contains credentials');
  paths.length = 0;
  await downloadPreparedExport({ accessToken: 'token' }, 'business-job');
  assert.deepEqual(paths, ['/api/business/reports/exports/business-job/download']);
});

test('identity switches cancel automatic export continuations at every network boundary', async (t) => {
  const browser = downloadBrowser(t);
  const first = { accessToken: 'old-token', user: { id: 'old-user' } };
  for (const audience of ['business', 'admin']) {
    for (const stage of ['start', 'start-json', 'status', 'status-json', 'download']) {
      for (const next of [{ accessToken: 'new-token', user: { id: 'new-user' } }, { ...first, user: { id: 'different-user' } }, null]) {
        const entered = deferred(), pending = deferred();
        const paths = [], signals = [];
        const ready = { id: 'old-job', status: 'ready', filename: 'old.csv' };
        const queued = { ...ready, status: 'queued' };
        const heldResponse = () => ({ ok: true, status: 200, json: () => { entered.resolve(); return pending.promise; } });
        let scope = setReportExportSession(first, audience);
        t.mock.method(globalThis, 'fetch', async (url, options) => {
          paths.push(url); signals.push(options.signal);
          if (url.includes('export.csv?')) {
            if (stage === 'start') { entered.resolve(); return pending.promise; }
            if (stage === 'start-json') return { ...heldResponse(), status: 202 };
            return Response.json({ data: queued }, { status: 202 });
          }
          if (url.endsWith('/download')) { entered.resolve(); return pending.promise; }
          if (stage === 'status') { entered.resolve(); return pending.promise; }
          if (stage === 'status-json') return heldResponse();
          return Response.json({ data: ready });
        });
        const result = downloadBusinessReport(first, 'days=30', { audience });
        await entered.promise;
        const priorProgress = browser.progress.length, priorDownloads = browser.downloads.length;
        scope = setReportExportSession(next, audience);
        await assert.rejects(result, { name: 'AbortError' });
        assert.ok(signals.every((signal) => signal.aborted));
        const callCount = paths.length;
        pending.resolve(stage.endsWith('json') ? { data: ready } : stage === 'download' ? new Response('old report') : Response.json({ data: ready }, { status: stage === 'start' ? 202 : 200 }));
        await Promise.resolve().then(() => Promise.resolve());
        assert.equal(paths.length, callCount, `${audience}/${stage} never continues an old download`);
        assert.equal(browser.progress.length, priorProgress);
        assert.equal(browser.downloads.length, priorDownloads);
        releaseReportExportSession(scope, audience);
      }
    }
  }
});

test('current-session exports run independently and same-identity updates retain both downloads', async (t) => {
  const { downloads } = downloadBrowser(t);
  const session = { accessToken: 'current-token', user: { id: 'current-user' } };
  const pending = [deferred(), deferred()]; const signals = [];
  let scope = setReportExportSession(session);
  t.after(() => releaseReportExportSession(scope));
  t.mock.method(globalThis, 'fetch', (_url, options) => { signals.push(options.signal); return pending[signals.length - 1].promise; });
  const first = downloadBusinessReport(session, 'exportTable=events');
  const second = downloadBusinessReport(session, 'exportTable=customers');
  scope = setReportExportSession({ ...session, user: { ...session.user, displayName: 'Updated name' } });
  assert.ok(signals.every((signal) => !signal.aborted));
  pending[1].resolve(new Response('second'));
  await second;
  assert.equal(signals[0].aborted, false);
  pending[0].resolve(new Response('first'));
  await first;
  assert.equal(downloads.length, 2);
  assert.match(downloads[0], /customers/); assert.match(downloads[1], /events/);
});

test('logout cancels pending blobs, file pickers, writable creation and streaming saves', async (t) => {
  const { downloads } = downloadBrowser(t);
  const session = { accessToken: 'file-token', user: { id: 'file-user' } };
  for (const stage of ['blob', 'picker', 'writable', 'stream']) {
    const entered = deferred(), pending = deferred();
    const calls = { opened: 0, piped: 0, aborted: 0 };
    let streamSignal;
    const writable = { abort: async () => { calls.aborted += 1; } };
    const file = { createWritable: () => { calls.opened += 1; if (stage === 'writable') { entered.resolve(); return pending.promise; } return Promise.resolve(writable); } };
    const response = {
      ok: true, status: 200,
      body: stage === 'blob' ? null : { pipeTo: (_writable, { signal }) => { calls.piped += 1; streamSignal = signal; entered.resolve(); return pending.promise; } },
      blob: () => { entered.resolve(); return pending.promise; },
    };
    window.showSaveFilePicker = stage === 'blob' ? undefined : () => { if (stage === 'picker') { entered.resolve(); return pending.promise; } return Promise.resolve(file); };
    t.mock.method(globalThis, 'fetch', async () => response);
    let scope = setReportExportSession(session);
    const download = downloadPreparedExport(session, 'old-job');
    await entered.promise;
    scope = setReportExportSession(null);
    await assert.rejects(download, { name: 'AbortError' });
    if (streamSignal) assert.equal(streamSignal.aborted, true);
    pending.resolve(stage === 'blob' ? new Blob(['old']) : stage === 'picker' ? file : stage === 'writable' ? writable : undefined);
    await Promise.resolve().then(() => Promise.resolve());
    assert.equal(downloads.length, 0, stage);
    assert.equal(calls.opened, ['writable', 'stream'].includes(stage) ? 1 : 0, stage);
    assert.equal(calls.piped, stage === 'stream' ? 1 : 0, stage);
    assert.equal(calls.aborted, ['writable', 'stream'].includes(stage) ? 1 : 0, 'cancelled saves abort writable handles without completing a file');
    releaseReportExportSession(scope);
  }
});

test('a cancelled fallback never clicks its link and promptly revokes an allocated blob URL', async (t) => {
  const { downloads } = downloadBrowser(t);
  const controller = new AbortController(), revoked = [];
  t.mock.method(URL, 'createObjectURL', () => { controller.abort(); return 'blob:cancelled-export'; });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  await assert.rejects(saveCsv(new Response('report'), 'cancelled.csv', { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(downloads, []);
  assert.deepEqual(revoked, ['blob:cancelled-export']);
});
