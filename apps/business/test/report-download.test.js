import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCsv } from '../src/lib/report-client.js';

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
