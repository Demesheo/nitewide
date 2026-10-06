const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { installAppStatic } = require('../src/http/app-static');
const { getConfig } = require('../src/config');
const { createRequireUser } = require('../src/http/middleware');
const { request: httpRequest } = require('./support/http-client.cjs');
const secret = 'test-signing-secret-only-not-for-deployment';
const demoEnvironment = { NODE_ENV: 'production', HOSTED_DEMO: 'true',
  DATABASE_URL: 'postgres://test:test@localhost/nitewide_demo',
  AUTH_TOKEN_SECRET: secret, QR_TOKEN_SECRET: 'test-qr-signing-secret-only-not-for-deployment',
  EMAIL_ENCRYPTION_KEY: 'test-email-encryption-key-only-not-for-deployment' };
async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (url, options) => httpRequest(server, url, options);
}
test('hosted config fails closed without production mode and dedicated secrets', () => {
  assert.throws(() => getConfig({ HOSTED_DEMO: 'true' }));
  assert.throws(() => getConfig({ NODE_ENV: 'production', HOSTED_DEMO: 'true' }));
  assert.equal(getConfig(demoEnvironment).hostedDemo, true);
  assert.equal(getConfig({}).hostedDemo, false);
});
test('hosted demo public pages need no shared password while account endpoints remain protected', async t => {
  const config = getConfig({ ...demoEnvironment, R2_ACCOUNT_ID: 'a'.repeat(32) });
  const staticRoot = await mkdtemp(path.join(os.tmpdir(), 'nitewide-public-demo-test-'));
  t.after(() => rm(staticRoot, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(staticRoot, 'apps', name, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><body>${name}</body></html>`);
  }
  const app = createApp({ sequelize: {}, models: {}, config, staticRoot, healthCheck: async () => {} });
  const request = await serve(t, app);
  assert.equal((await request('/demo-access')).headers.location, '/');
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.equal(home.text, '<html><body>customer</body></html>');
  assert.equal(home.headers['set-cookie'], undefined);
  assert.match(home.headers['x-robots-tag'], /noindex/);
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.match(home.headers['content-security-policy'], /img-src 'self' data: https:\/\/a{32}\.r2\.cloudflarestorage\.com;/);
  assert.doesNotMatch(home.headers['content-security-policy'], /\*\.r2/);
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
test('non-demo releases serve all apps with secure routes and stage-only indexing protection', async t => {
  const { createDemoStaticFixture } = require('./support/demo-static-fixture.cjs');
  const root = await createDemoStaticFixture(t);
  for (const APP_ENVIRONMENT of ['staging', 'production']) {
    const config = getConfig({ ...demoEnvironment, HOSTED_DEMO: 'false', APP_ENVIRONMENT, SERVE_FRONTENDS: 'true',
      DATABASE_URL: `postgres://test:test@database.example/nitewide_${APP_ENVIRONMENT}`, DATABASE_SSL: 'true',
      CUSTOMER_APP_URL: `https://${APP_ENVIRONMENT}.example.test`, BUSINESS_APP_URL: `https://${APP_ENVIRONMENT}.example.test/app`,
      MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: `nitewide-${APP_ENVIRONMENT}-media`,
      R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret-key-for-offline-tests' });
    const app = createApp({ sequelize: {}, models: {}, config, staticRoot: root, healthCheck: async () => {} });
    const request = await serve(t, app);
    for (const [url, name] of [['/', 'customer'], ['/business', 'business'], ['/sign-in', 'business'], ['/app?section=events', 'business'], ['/admin/', 'admin']]) {
      const response = await request(url);
      assert.equal(response.status, 200);
      assert.match(response.text, new RegExp(`${name} test fixture`));
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(Boolean(response.headers['x-robots-tag']), APP_ENVIRONMENT === 'staging');
    }
    assert.equal((await request('/api/auth/me', { headers: { 'x-user-id': 'admin' } })).status, 401);
    assert.equal((await request('/api/not-real')).status, 404);
    assert.equal((await request('/demo-access')).status, 404);
    assert.equal((await request('/business/assets/missing.js')).status, 404);
    assert.equal((await request('/.env')).status, 404);
  }
});
test('single-origin demo maps each app and assets without swallowing unknown API routes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-static-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const app of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', app, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), app === 'admin' ? '<main>admin</main>' : `<html><body><main>${app}</main></body></html>`);
    await writeFile(path.join(dist, 'assets', 'app.js'), `// ${app}`);
  }
  const app = express(); installAppStatic(app, root);
  const request = await serve(t, app);
  for (const [url, name] of [['/', 'customer'], ['/business', 'business'], ['/app', 'business'], ['/sign-in', 'business'], ['/admin', 'admin']]) {
    const response = await request(url); const html = response.text;
    assert.equal(response.status, 200); assert.match(html, new RegExp(`<main>${name}</main>`));
    assert.doesNotMatch(html, /Public demo|Shared sample data|No real charges|role="status"/);
    if (name === 'admin') {
      assert.match(html, /<meta name="viewport"/);
      assert.match(html, /<title>Nitewide Admin<\/title>/);
    } else {
      assert.equal(html, `<html><body><main>${name}</main></body></html>`);
    }
  }
  assert.match((await request('/business/assets/app.js')).text, /business/);
  assert.match((await request('/admin/assets/app.js')).text, /admin/);
  assert.equal((await request('/api/not-real')).status, 404);
  assert.equal((await request('/.env')).status, 404);
});
test('legacy root team/promoter invitations redirect to Business without changing customer links', async t => {
  const { createDemoStaticFixture } = require('./support/demo-static-fixture.cjs');
  const root = await createDemoStaticFixture(t);
  const app = express(); installAppStatic(app, root);
  const request = await serve(t, app);
  const token = 'synthetic +/?&=# invitation';
  const query = new URLSearchParams({ invite: token, returnTo: 'https://untrusted.example/', city: 'Orlando, FL' });
  for (const method of ['GET', 'HEAD']) {
    const response = await request(`/?${query}`, { method });
    assert.equal(response.status, 302);
    assert.equal(response.headers['cache-control'], 'no-store');
    const destination = new URL(response.headers.location, 'https://nitewide-demo.onrender.com');
    assert.equal(destination.origin, 'https://nitewide-demo.onrender.com');
    assert.equal(destination.pathname, '/app');
    assert.deepEqual([...destination.searchParams], [...query]);
    const landing = await request(response.headers.location);
    assert.equal(landing.status, 200);
    assert.match(landing.text, /business test fixture/);
    assert.equal(landing.headers['cache-control'], 'no-store');
  }
  for (const url of ['/', '/?city=Orlando', '/?invite=', '/?guestlistInvite=synthetic-guest-token', '/?ref=synthetic-referral', '/?onboarding=synthetic-onboarding']) {
    const response = await request(url);
    assert.equal(response.status, 200, url);
    assert.match(response.text, /customer test fixture/, url);
    assert.equal(response.headers.location, undefined, url);
  }
});
test('entry documents are not cached and missing release assets never become HTML or cached failures', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-static-cache-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', name, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><body>${name}</body></html>`);
    await writeFile(path.join(dist, 'assets', 'App-abcdefgh.js'), 'export default {};');
    await writeFile(path.join(dist, 'assets', 'index-abcdefgh.css'), 'body { color: white; }');
    await writeFile(path.join(dist, 'assets', 'unversioned.js'), 'export default {};');
  }
  const app = express(); installAppStatic(app, root);
  const request = await serve(t, app);
  for (const url of ['/', '/?city=Orlando', '/index.html', '/app', '/app?section=events', '/sign-in', '/business', '/business/', '/admin', '/admin/']) {
    const response = await request(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers['content-type'], /text\/html/, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
  }
  for (const prefix of ['/assets', '/business/assets', '/admin/assets']) {
    for (const filename of ['App-abcdefgh.js', 'index-abcdefgh.css']) {
      const response = await request(`${prefix}/${filename}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    }
    const unversioned = await request(`${prefix}/unversioned.js`);
    assert.equal(unversioned.headers['cache-control'], 'public, max-age=0, must-revalidate');
    for (const method of ['GET', 'HEAD']) {
      const response = await request(`${prefix}/App-oldbuild.js`, { method });
      assert.equal(response.status, 404);
      assert.match(response.headers['content-type'], /text\/plain/);
      assert.equal(response.headers['cache-control'], 'no-store');
      if (method === 'GET') assert.equal(response.text, 'Asset not found');
    }
  }
});
