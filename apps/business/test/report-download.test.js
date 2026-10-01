import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCsv, downloadBusinessReport, downloadPreparedExport } from '../src/lib/report-client.js';

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
  paths.length = 0;
  await downloadPreparedExport({ accessToken: 'token' }, 'business-job');
  assert.deepEqual(paths, ['/api/business/reports/exports/business-job/download']);
});
