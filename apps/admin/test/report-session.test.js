import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('Admin persisted session changes cancel downloads without allowing stale auth responses to replace the current identity', async t => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const result = await build({ stdin: {
    contents: "export * from './apps/admin/src/lib/api.js'; export { downloadPreparedExport } from './apps/business/src/lib/report-client.js'; export { setReportExportSession, releaseReportExportSession } from './apps/business/src/lib/report-export-session.js';",
    resolveDir: root,
  }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  const { api, clearSession, readSession, signIn, verifySession, downloadPreparedExport, setReportExportSession, releaseReportExportSession } = module.exports;
  const store = new Map(), downloads = [];
  const globals = {
    sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) },
    window: {}, document: { createElement: () => ({ click() { downloads.push(this.download); } }) },
  };
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let scope;
  t.after(() => {
    if (scope) releaseReportExportSession(scope, 'admin');
    for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  });
  const oldSession = { accessToken: 'old-admin-token', user: { id: 'old-admin' } };
  const newSession = { accessToken: 'new-admin-token', user: { id: 'new-admin' } };
  function restoreOld() { sessionStorage.setItem('nitewide.admin.session', JSON.stringify(oldSession)); scope = setReportExportSession(oldSession, 'admin'); }

  await t.test('a current-session 401 clears storage and cancels a pending blob save', async subtest => {
    restoreOld();
    const entered = deferred(), blob = deferred();
    subtest.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/download')
      ? { ok: true, status: 200, blob: () => { entered.resolve(); return blob.promise; } }
      : Response.json({ error: { message: 'Revoked session' } }, { status: 401 }));
    const download = downloadPreparedExport(oldSession, 'old-job', 'old.csv', { audience: 'admin' });
    await entered.promise;
    await assert.rejects(api('/admin/reports/bootstrap'), { status: 401 });
    assert.equal(readSession(), null);
    await assert.rejects(download, { name: 'AbortError' });
    blob.resolve(new Blob(['old report']));
    await Promise.resolve().then(() => Promise.resolve());
    assert.deepEqual(downloads, []);
  });

  for (const stale of ['401', 'verification']) {
    await t.test(`a late old-session ${stale} cannot clear or rebind the new session and its pending download`, async subtest => {
      restoreOld();
      const oldResponse = deferred(), entered = deferred(), blob = deferred();
      let downloadSignal;
      subtest.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url.endsWith('/auth/sign-in')) return Response.json({ data: newSession });
        if (url.endsWith('/download')) {
          downloadSignal = options.signal;
          assert.equal(options.headers.Authorization, 'Bearer new-admin-token');
          return { ok: true, status: 200, blob: () => { entered.resolve(); return blob.promise; } };
        }
        assert.equal(options.headers.Authorization, 'Bearer old-admin-token');
        return oldResponse.promise;
      });
      const priorRequest = stale === '401' ? api('/admin/reports/bootstrap') : verifySession();
      await signIn('fixture@example.test', 'fixture-password');
      const download = downloadPreparedExport(newSession, 'new-job', 'new.csv', { audience: 'admin' });
      await entered.promise;
      oldResponse.resolve(stale === '401'
        ? Response.json({ error: { message: 'Old session revoked' } }, { status: 401 })
        : Response.json({ data: { user: oldSession.user, roles: ['internal_admin'] } }));
      await assert.rejects(priorRequest, stale === '401' ? { status: 401 } : { name: 'AbortError' });
      assert.deepEqual(readSession(), newSession);
      assert.equal(clearSession(oldSession), false);
      assert.equal(downloadSignal.aborted, false);
      blob.resolve(new Blob(['new report']));
      await download;
      assert.equal(downloads.at(-1), 'new.csv');
      scope = setReportExportSession(newSession, 'admin');
    });
  }

  await t.test('late verification after logout cannot resurrect stored credentials', async subtest => {
    restoreOld();
    const oldResponse = deferred();
    subtest.mock.method(globalThis, 'fetch', () => oldResponse.promise);
    const verification = verifySession();
    assert.equal(clearSession(), true);
    oldResponse.resolve(Response.json({ data: { user: oldSession.user, roles: ['internal_admin'] } }));
    await assert.rejects(verification, { name: 'AbortError' });
    assert.equal(readSession(), null);
    await assert.rejects(downloadPreparedExport(oldSession, 'old-job', 'old.csv', { audience: 'admin' }), { name: 'AbortError' });
  });
});
