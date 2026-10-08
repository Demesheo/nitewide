import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('Business persisted session transitions synchronously cancel exports and reject stale session writes', async t => {
  const result = await build({ stdin: {
    contents: "export { SESSION_KEY, readSession, writeSession } from './apps/business/src/lib/api.js'; export { beginReportExport, releaseReportExportSession, setReportExportSession } from './apps/business/src/lib/report-export-session.js';",
    resolveDir: fileURLToPath(new URL('../../..', import.meta.url)),
  }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { SESSION_KEY, readSession, writeSession, beginReportExport, releaseReportExportSession, setReportExportSession } = module.exports;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key),
  } });
  t.after(() => {
    releaseReportExportSession(setReportExportSession(null));
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage;
  });
  const first = { accessToken: 'first-token', user: { id: 'first-user' }, expiresAt: '2099-01-01T00:00:00Z' };
  const second = { accessToken: 'second-token', user: { id: 'second-user' }, expiresAt: first.expiresAt };
  assert.equal(writeSession(first), true);
  const original = beginReportExport(first);
  const metadata = { ...first, user: { ...first.user, displayName: 'Updated profile' } };
  assert.equal(writeSession(metadata, first), true);
  assert.equal(original.signal.aborted, false, 'metadata refresh preserves the same identity export');
  assert.equal(writeSession(second), true);
  assert.equal(original.signal.aborted, true, 'cancellation happens at the persisted switch before any React effect');
  const current = beginReportExport(second);
  for (const stale of [null, metadata, { ...first, accessToken: 'old-password-replacement' }]) {
    assert.equal(writeSession(stale, first), false, 'late logout, verification, profile and password responses cannot replace the new identity');
    assert.deepEqual(readSession(), second);
    assert.equal(current.signal.aborted, false);
  }
  assert.equal(writeSession(null, second), true);
  assert.equal(current.signal.aborted, true);
  assert.equal(sessionStorage.getItem(SESSION_KEY), null);
  original.finish(); current.finish();
  const expired = { ...first, expiresAt: '2000-01-01T00:00:00Z' };
  writeSession(expired);
  assert.equal(readSession(), null);
  assert.equal(writeSession(null, expired), true, 'expiry still clears matching persisted credentials');
});
