const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { installDemoStatic } = require('../src/http/demo-static');
const { getConfig } = require('../src/config');
const { createRequireUser } = require('../src/http/middleware');
const secret = 'test-signing-secret-only-not-for-deployment';
async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (url, options) => fetch(origin + url, { redirect: 'manual', ...options });
}
test('hosted config fails closed without production mode and dedicated secrets', () => {
  assert.throws(() => getConfig({ HOSTED_DEMO: 'true' }));
  assert.throws(() => getConfig({ NODE_ENV: 'production', HOSTED_DEMO: 'true' }));
  assert.equal(getConfig({ NODE_ENV: 'production', HOSTED_DEMO: 'true', AUTH_TOKEN_SECRET: secret }).hostedDemo, true);
  assert.equal(getConfig({}).hostedDemo, false);
});
test('hosted demo public pages need no shared password while account endpoints remain protected', async t => {
  const config = getConfig({ NODE_ENV: 'production', HOSTED_DEMO: 'true', AUTH_TOKEN_SECRET: secret });
  const staticRoot = await mkdtemp(path.join(os.tmpdir(), 'nitewide-public-demo-test-'));
  t.after(() => rm(staticRoot, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(staticRoot, 'apps', name, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><body>${name}</body></html>`);
  }
  const app = createApp({ sequelize: {}, models: {}, config, staticRoot, healthCheck: async () => {} });
  const request = await serve(t, app);
  assert.equal((await request('/demo-access')).headers.get('location'), '/');
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Public demo/);
  assert.equal(home.headers.get('set-cookie'), null);
  assert.match(home.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/me', { headers: { 'x-user-id': 'admin' } })).status, 401);
});
test('production authentication cannot be bypassed using the development user header', async t => {
  const app = express();
  app.use(createRequireUser({ authenticate: async () => ({ id: 'authorized-user' }), allowDevelopmentUserHeader: false }));
  app.get('/', (req, res) => res.json({ id: req.userId }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  const request = await serve(t, app);
  assert.equal((await request('/', { headers: { 'x-user-id': 'admin' } })).status, 401);
  assert.equal((await request('/', { headers: { authorization: 'Bearer valid-session' } })).status, 200);
});
test('single-origin demo maps each app and assets without swallowing unknown API routes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-static-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const app of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', app, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><body><main>${app}</main></body></html>`);
    await writeFile(path.join(dist, 'assets', 'app.js'), `// ${app}`);
  }
  const app = express(); installDemoStatic(app, root);
  const request = await serve(t, app);
  for (const [url, name] of [['/', 'customer'], ['/business', 'business'], ['/app', 'business'], ['/sign-in', 'business'], ['/admin', 'admin']]) {
    const response = await request(url); const html = await response.text();
    assert.equal(response.status, 200); assert.match(html, new RegExp(`<main>${name}</main>`)); assert.match(html, /No real charges/);
  }
  assert.match(await (await request('/business/assets/app.js')).text(), /business/);
  assert.match(await (await request('/admin/assets/app.js')).text(), /admin/);
  assert.equal((await request('/api/not-real')).status, 404);
  assert.equal((await request('/.env')).status, 404);
});
