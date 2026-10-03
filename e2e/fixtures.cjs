const { test: base, expect } = require('@playwright/test');
const { urls, controlToken } = require('./environment.cjs');
const path = require('node:path');
const { createTimingCollector } = require('../scripts/test-timing.cjs');

const timing = createTimingCollector('browser-fixtures');
const labelsFor = (testInfo, extra = {}) => ({ suite: path.basename(testInfo.file), project: testInfo.project.name, ...extra });

const test = base.extend({
  fixtureRecipe: ['legacy', { option: true }],
  timingReport: [async ({}, use) => {
    await use();
    timing.report();
  }, { scope: 'worker', auto: true }],
  fixture: async ({ request, fixtureRecipe }, use, testInfo) => {
    const fixture = await timing.measure('fixture-reset', async () => {
      const response = await request.post(`${urls.api}/__e2e/reset`, { headers: { 'x-e2e-control': controlToken }, data: { recipe: fixtureRecipe } });
      expect(response.ok(), `disposable database reset (HTTP ${response.status()})`).toBeTruthy();
      return response.json();
    }, labelsFor(testInfo, { role: fixtureRecipe }));
    await use(fixture);
  },
  // Catch runtime regressions, not just failed assertions. Expected negative
  // API responses (401/403/409) are asserted in their own tests.
  browserGuard: [async ({ context, page }, use) => {
    const errors = [];
    const watched = new WeakSet();
    const watch = current => {
      if (watched.has(current)) return;
      watched.add(current);
      current.on('pageerror', error => errors.push(error.message));
      current.on('console', message => { if (/Encountered two children with the same key|Each child in a list should have a unique/.test(message.text())) errors.push(message.text()); });
    };
    context.on('page', watch);
    context.pages().forEach(watch); watch(page);
    // Do not intercept local API traffic: WebKit navigation cancellation and
    // browser-native downloads should retain their normal network behavior.
    await context.route(url => ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort('blockedbyclient'));
    await use();
    expect(errors, 'uncaught errors and duplicate React keys').toEqual([]);
  }, { auto: true }],
});

async function login(page, fixture, app, role = app, destination = app === 'business' ? '/app' : '/') {
  const account = fixture.accounts[role];
  const labels = labelsFor(test.info(), { app, role });
  await timing.measure('fresh-auth', async () => {
    await page.goto(`${urls[app]}${destination}`);
    if (app === 'customer') await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.getByLabel(app === 'customer' ? 'Email address' : app === 'business' ? 'Work email' : 'Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: app === 'customer' ? 'Sign in' : app === 'business' ? 'Sign in to Nitewide' : 'Sign in securely', exact: true }).click();
  }, labels);
  await timing.measure('browser-readiness', () => expectAuthenticated(page, account, app), labels);
}

// Feature tests still create a real session after their disposable DB reset.
// Dedicated auth tests use login() to retain the form submission coverage.
async function loginViaApi(page, fixture, app, role = app, destination = app === 'business' ? '/app' : '/') {
  const account = fixture.accounts[role];
  const labels = labelsFor(test.info(), { app, role });
  const endpoint = app === 'business' ? '/api/auth/business/sign-in' : '/api/auth/sign-in';
  const session = await timing.measure('fresh-auth', async () => {
    const response = await page.request.post(`${urls.api}${endpoint}`, { data: { email: account.email, password: fixture.password } });
    expect(response.ok(), `fresh ${app} session (HTTP ${response.status()})`).toBeTruthy();
    const fresh = (await response.json()).data;
    expect(fresh.accessToken).toEqual(expect.any(String));
    expect(fresh.user.id).toBe(account.id);
    return fresh;
  }, labels);

  // A temporary empty document supplies the app's origin without mounting it.
  // Seed storage once; no persistent init script may restore an old token on
  // reload, logout, password rotation or a later sign-in on the same page.
  const bootstrap = `${urls[app]}/__e2e/session-bootstrap`;
  const emptyDocument = route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated session setup</title>' });
  await timing.measure('session-bootstrap', async () => {
    await page.route(bootstrap, emptyDocument);
    try {
      await page.goto(bootstrap);
      await page.evaluate(({ storage, key, session }) => window[storage].setItem(key, JSON.stringify(session)), {
        storage: app === 'customer' ? 'localStorage' : 'sessionStorage',
        key: app === 'customer' ? 'nitewide.session' : `nitewide.${app}.session`, session,
      });
    } finally {
      await page.unroute(bootstrap, emptyDocument);
    }
  }, labels);
  await timing.measure('browser-readiness', async () => {
    if (app === 'customer') {
      // Deep-linked dialogs correctly hide the header from the accessibility
      // tree. Verify the real client bootstrap, not an inaccessible background
      // control whose visibility races the modal opening.
      const [verified] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me' &&
          response.request().headers().authorization === `Bearer ${session.accessToken}`, { timeout: 10000 }),
        page.goto(`${urls[app]}${destination}`),
      ]);
      expect(verified.ok(), 'customer client session verification').toBeTruthy();
      expect((await verified.json()).data.user.id).toBe(account.id);
      await expect(page.getByRole('button', { name: `Open ${account.name}'s profile`, includeHidden: true })).toBeAttached();
    } else {
      await page.goto(`${urls[app]}${destination}`);
      await expectAuthenticated(page, account, app);
    }
  }, labels);
  return session;
}

async function expectAuthenticated(page, account, app) {
  if (app === 'customer') await expect(page.getByRole('button', { name: `Open ${account.name}'s profile` })).toBeVisible();
  else if (app === 'business') await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}
async function businessSection(page, section) {
  const buttons = page.getByRole('navigation').getByRole('button', { name: section, exact: true });
  await buttons.filter({ visible: true }).click();
}
async function adminSection(page, section) {
  const navigation = page.getByRole('navigation', { name: 'Admin sections', exact: true, includeHidden: true });
  // Session verification can outlive page.goto(). Wait for the authenticated
  // shell before deciding whether the responsive sidebar needs to be opened.
  await expect(navigation).toBeAttached();
  if (!await navigation.isVisible()) {
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  }
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name: section, exact: true }).click();
}
async function expectNoOverflow(page) {
  // Responsive components may need a render after a viewport change. Retry the
  // actual geometry assertion instead of measuring during that transient frame.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    { message: 'Page content must fit the current viewport' }).toBeLessThanOrEqual(1);
}
module.exports = { test, expect, login, loginViaApi, businessSection, adminSection, expectNoOverflow };
