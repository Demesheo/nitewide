const { test: base, expect } = require('@playwright/test');
const { urls, controlToken } = require('./environment.cjs');

const test = base.extend({
  fixture: async ({ request }, use) => {
    const response = await request.post(`${urls.api}/__e2e/reset`, { headers: { 'x-e2e-control': controlToken } });
    expect(response.ok(), `disposable database reset (HTTP ${response.status()})`).toBeTruthy();
    await use(await response.json());
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
  await page.goto(`${urls[app]}${destination}`);
  if (app === 'customer') await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel(app === 'customer' ? 'Email address' : app === 'business' ? 'Work email' : 'Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: app === 'customer' ? 'Sign in' : app === 'business' ? 'Sign in to Nitewide' : 'Sign in securely', exact: true }).click();
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
module.exports = { test, expect, login, businessSection, adminSection, expectNoOverflow };
