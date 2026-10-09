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
  const publicConfig = await request('/app-config.js');
  const window = {};
  require('node:vm').runInNewContext(publicConfig.text, { window });
  assert.deepEqual(JSON.parse(JSON.stringify(window.__NITEWIDE_PUBLIC_CONFIG__)), {
    customerUrl: '/', businessHome: '/business', businessWorkspace: '/business?section=overview', adminUrl: '/admin',
  }, 'path-mode demo without explicit callback URLs must never link to localhost');
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
      CUSTOMER_APP_URL: `https://${APP_ENVIRONMENT}.example.test`, BUSINESS_APP_URL: `https://${APP_ENVIRONMENT}.example.test/business`,
      MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: `nitewide-${APP_ENVIRONMENT}-media`,
      R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret-key-for-offline-tests' });
    const app = createApp({ sequelize: {}, models: {}, config, staticRoot: root, healthCheck: async () => {} });
    const request = await serve(t, app);
    for (const [url, name] of [['/', 'customer'], ['/business', 'business'], ['/sign-in', 'business'], ['/business?section=events', 'business'], ['/admin/', 'admin']]) {
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
  for (const [url, name] of [['/', 'customer'], ['/business', 'business'], ['/business?section=overview', 'business'], ['/sign-in', 'business'], ['/admin', 'admin']]) {
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
  for (const url of ['/app', '/app/', '/app?invite=synthetic-token']) assert.equal((await request(url)).status, 404);
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
    assert.equal(destination.pathname, '/business');
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
  for (const url of ['/', '/?city=Orlando', '/index.html', '/business?section=overview', '/business?section=events', '/sign-in', '/business', '/business/', '/admin', '/admin/']) {
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

test('subdomains route each built app, public configuration and legacy links without relaxing authentication or caching', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nitewide-subdomain-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['customer', 'business', 'admin']) {
    const dist = path.join(root, 'apps', name, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), `<html><head><title>${name}</title></head><body>${name} test fixture</body></html>`);
    await writeFile(path.join(dist, 'assets', 'App-abcdefgh.js'), `// ${name}`);
    await writeFile(path.join(dist, 'favicon.png'), `${name} icon`);
  }
  const config = getConfig({ ...demoEnvironment, LOG_LEVEL: 'silent', APP_ROUTING_MODE: 'subdomains',
    CUSTOMER_APP_URL: 'https://staging.nitewide.test', BUSINESS_APP_URL: 'https://business-staging.nitewide.test',
    ADMIN_APP_URL: 'https://admin-staging.nitewide.test',
    CORS_ORIGINS: 'https://staging.nitewide.test,https://business-staging.nitewide.test,https://admin-staging.nitewide.test',
    STRIPE_SECRET_KEY: 'sk_test_syntheticprivate' });
  const app = createApp({ sequelize: {}, models: {}, config, staticRoot: root, healthCheck: async () => {} });
  const request = await serve(t, app);
  const hosts = { customer: 'staging.nitewide.test', business: 'business-staging.nitewide.test', admin: 'admin-staging.nitewide.test' };
  for (const [name, host] of Object.entries(hosts)) {
    const headers = { host };
    for (const url of ['/', '/index.html']) {
      const page = await request(url, { headers });
      assert.equal(page.status, 200);
      assert.match(page.text, new RegExp(`${name} test fixture`));
      assert.match(page.text, /<script src="\/app-config.js"><\/script><\/head>/);
      assert.equal(page.headers['cache-control'], 'no-store');
    }
    const runtime = await request('/app-config.js', { headers });
    assert.equal(runtime.status, 200);
    assert.match(runtime.headers['content-type'], /javascript/);
    assert.equal(runtime.headers['cache-control'], 'no-store');
    assert.equal(runtime.headers['x-content-type-options'], 'nosniff');
    const window = {};
    require('node:vm').runInNewContext(runtime.text, { window });
    assert.equal(Object.isFrozen(window.__NITEWIDE_PUBLIC_CONFIG__), true);
    assert.deepEqual(JSON.parse(JSON.stringify(window.__NITEWIDE_PUBLIC_CONFIG__)), {
      customerUrl: 'https://staging.nitewide.test/', businessHome: 'https://business-staging.nitewide.test/',
      businessWorkspace: 'https://business-staging.nitewide.test/?section=overview', adminUrl: 'https://admin-staging.nitewide.test/',
    });
    for (const secretValue of [config.AUTH_TOKEN_SECRET, config.QR_TOKEN_SECRET, config.EMAIL_ENCRYPTION_KEY, config.DATABASE_URL, config.STRIPE_SECRET_KEY]) {
      assert.ok(!runtime.text.includes(secretValue));
    }
    assert.equal((await request('/api/auth/me', { headers: { ...headers, 'x-user-id': 'admin' } })).status, 401);
    assert.equal((await request('/api/not-real', { headers })).status, 404);
    const asset = await request(`${name === 'customer' ? '' : `/${name}`}/assets/App-abcdefgh.js`, { headers });
    assert.equal(asset.status, 200);
    assert.equal(asset.text, `// ${name}`);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    for (const url of ['/assets/missing.js', '/.env', '/not-real', '/app', '/app/', '/app?invite=synthetic-token']) {
      const missing = await request(url, { headers });
      assert.equal(missing.status, 404);
      assert.equal(missing.headers['cache-control'], 'no-store');
      assert.doesNotMatch(missing.headers['content-type'], /text\/html/);
    }
    assert.equal((await request('/favicon.png', { headers })).body.toString(), `${name} icon`);
    const cors = await request('/api/auth/me', { method: 'OPTIONS', headers: { ...headers, origin: config.ADMIN_APP_URL, 'access-control-request-method': 'GET' } });
    assert.equal(cors.headers['access-control-allow-origin'], config.ADMIN_APP_URL);
    const blocked = await request('/api/auth/me', { method: 'OPTIONS', headers: { ...headers, origin: 'https://untrusted.test', 'access-control-request-method': 'GET' } });
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
  }
  const query = new URLSearchParams({ invite: 'synthetic +/?&=# invitation', returnTo: 'https://untrusted.test/' });
  for (const host of [hosts.customer]) {
    const invitation = await request(`/?${query}`, { headers: { host } });
    assert.equal(invitation.status, 302);
    const target = new URL(invitation.headers.location);
    assert.equal(target.origin, 'https://business-staging.nitewide.test');
    assert.equal(target.pathname, '/');
    assert.deepEqual([...target.searchParams], [...query]);
    assert.equal(invitation.headers['cache-control'], 'no-store');
  }
  const businessInvitation = await request(`/?${query}`, { headers: { host: hosts.business } });
  assert.equal(businessInvitation.status, 200, 'Business invitations must not redirect to themselves');
  assert.equal(businessInvitation.headers.location, undefined);
  assert.match(businessInvitation.text, /business test fixture/);
  for (const [host, url, expected] of [
    [hosts.customer, '/business?ref=keep', 'https://business-staging.nitewide.test/?ref=keep'],
    [hosts.customer, '/sign-in?invite=keep', 'https://business-staging.nitewide.test/sign-in?invite=keep'],
    [hosts.business, '/admin?section=people', 'https://admin-staging.nitewide.test/?section=people'],
    [hosts.admin, '/admin?section=people', 'https://admin-staging.nitewide.test/?section=people'],
  ]) assert.equal((await request(url, { headers: { host } })).headers.location, expected);
  for (const url of ['/?section=overview', '/sign-in', '/?section=events', '/?onboarding=synthetic', '/?section=payments&paymentAccountReturn=synthetic']) {
    assert.match((await request(url, { headers: { host: hosts.business } })).text, /business test fixture/);
  }
  for (const url of ['/?guestlistInvite=synthetic', '/?ref=synthetic', '/?onboarding=synthetic']) {
    assert.match((await request(url, { headers: { host: hosts.customer } })).text, /customer test fixture/);
  }
  assert.equal((await request('/business/assets/App-abcdefgh.js', { headers: { host: hosts.customer } })).status, 404);
  assert.equal((await request('/', { headers: { host: hosts.business.toUpperCase() + ':443' } })).status, 200);
  for (const host of ['unknown.test', `${hosts.customer}.untrusted.test`, 'nitewide-staging.onrender.com']) {
    for (const url of ['/', '/app-config.js', '/api/auth/me', '/assets/App-abcdefgh.js']) {
      const response = await request(url, { headers: { host, 'x-forwarded-host': hosts.admin } });
      assert.equal(response.status, 404);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.equal((await request('/health/ready', { headers: { host } })).status, 200);
  }
});
