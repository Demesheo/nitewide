#!/usr/bin/env node
// Offline routing rehearsal, not a cloud/Stripe test. Synthetic HTTPS origins
// are fulfilled exclusively through our disposable loopback HTTP server.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium, webkit, devices, expect } = require('@playwright/test');
const { createApp } = require('../apps/api/src/app');
const { getConfig } = require('../apps/api/src/config');
const { frontendBuildEnvironment } = require('./environment.cjs');
const { createCommandRunner } = require('../scripts/test-command.cjs');

const root = path.resolve(__dirname, '..');
const origins = {
  customer: 'https://staging.nitewide.test', business: 'https://business-staging.nitewide.test', admin: 'https://admin-staging.nitewide.test',
};
const config = getConfig({ NODE_ENV: 'production', APP_ENVIRONMENT: 'staging', APP_ROUTING_MODE: 'subdomains',
  SERVE_FRONTENDS: 'true', HOSTED_DEMO: 'false', LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://synthetic:synthetic@database.example/nitewide_staging', DATABASE_SSL: 'true',
  AUTH_TOKEN_SECRET: 'offline-auth-secret-never-for-deployment', QR_TOKEN_SECRET: 'offline-qr-secret-never-for-deployment',
  EMAIL_ENCRYPTION_KEY: 'offline-email-secret-never-for-deployment',
  MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'nitewide-staging-media',
  R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret-never-for-deployment',
  CUSTOMER_APP_URL: origins.customer, BUSINESS_APP_URL: `${origins.business}/app`, ADMIN_APP_URL: origins.admin,
  CORS_ORIGINS: Object.values(origins).join(','), STRIPE_MODE: 'disabled',
});

function apiFixture(url, method) {
  if (method === 'GET' && url.pathname === '/api/events') return { data: { items: [], nextCursor: null } };
  if (method === 'GET' && url.pathname === '/api/customer/payment-config') return { data: { enabled: false, demoEnabled: false, mode: 'disabled' } };
  if (method === 'GET' && url.pathname === '/api/team/invitations/synthetic-team-token') return { data: {
    organizationName: 'Routing Test Business', name: 'Routing Test Guest', role: 'manager',
    email: 'test+routing@nitewide.test', accountMode: 'new', expiresAt: '2099-01-01T00:00:00.000Z',
  } };
  return null;
}

async function checkBrowser(name, browserType, options, loopback) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block', reducedMotion: 'reduce',
      timezoneId: 'America/New_York', locale: 'en-US' });
    const failures = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      // Existing CSS imports Google Fonts. Use local fallbacks in this offline
      // routing test instead of contacting a third-party font service.
      if (url.origin === 'https://fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      if (!Object.values(origins).includes(url.origin)) {
        failures.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      }
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/me') {
        const fixture = apiFixture(url, request.method());
        // No database/provider calls or writes, even for guestlist claim pages.
        return route.fulfill({ status: fixture ? 200 : 404, contentType: 'application/json',
          body: JSON.stringify(fixture || { error: { code: 'NOT_FOUND', message: 'Synthetic invitation unavailable' } }) });
      }
      const response = await route.fetch({ url: `${loopback}${url.pathname}${url.search}`,
        headers: { ...request.headers(), host: url.host }, maxRedirects: 0 });
      return route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/')) failures.push(`Missing entry asset: ${response.url()}`);
    });
    page.setDefaultTimeout(10000);
    async function checkDocument(url) {
      // Browser interception doesn't reliably re-intercept HTTP redirect
      // chains. Inspect each redirect through loopback, then open its verified
      // destination; never let a synthetic hostname resolve on the network.
      let target = new URL(url);
      for (let hops = 0; hops < 4; hops++) {
        assert.ok(Object.values(origins).includes(target.origin));
        const response = await context.request.get(`${loopback}${target.pathname}${target.search}`, { headers: { host: target.host }, maxRedirects: 0 });
        if (response.status() !== 302) { assert.equal(response.status(), 200); break; }
        assert.ok(hops < 3, 'Redirect loop');
        target = new URL(response.headers().location, target);
      }
      await page.goto(target.toString());
      await expect(page.locator('#root')).not.toBeEmpty();
      assert.equal(await page.evaluate(() => window.__NITEWIDE_PUBLIC_CONFIG__?.customerUrl), `${origins.customer}/`);
    }
    async function noOverflow() {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
    }

    await checkDocument(origins.customer);
    await expect(page.getByRole('link', { name: 'For business' })).toHaveAttribute('href', `${origins.business}/`);
    await page.evaluate(() => sessionStorage.setItem('routing-isolation', 'customer-only'));
    await page.getByRole('link', { name: 'For business' }).click();
    await expect(page).toHaveURL(`${origins.business}/`);
    await expect(page.getByRole('link', { name: 'Explore events', exact: true, includeHidden: true }).first()).toHaveAttribute('href', `${origins.customer}/`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('routing-isolation')), null);
    await noOverflow();
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
    await expect(page).toHaveURL(`${origins.business}/sign-in`);
    await expect(page.getByRole('form', { name: 'Business sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'About Nitewide Business' })).toHaveAttribute('href', `${origins.business}/`);
    await noOverflow();
    await page.reload();
    await expect(page.getByRole('form', { name: 'Business sign in' })).toBeVisible();
    await checkDocument(`${origins.business}/app?section=events`);
    await expect(page.getByRole('form', { name: 'Business sign in' })).toBeVisible();

    await checkDocument(`${origins.customer}/?invite=synthetic-team-token`);
    await expect(page).toHaveURL(`${origins.business}/app?invite=synthetic-team-token`);
    await expect(page.getByRole('form', { name: 'Create account and accept invitation' })).toBeVisible();
    await expect(page.getByLabel('Confirm password', { exact: true })).toBeVisible();
    await noOverflow();
    await checkDocument(`${origins.customer}/?guestlistInvite=synthetic-guest-token`);
    await expect(page.getByRole('heading', { name: 'Your guestlist invitation' })).toBeVisible();
    assert.equal(new URL(page.url()).origin, origins.customer);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('routing-isolation')), 'customer-only');

    await checkDocument(origins.admin);
    await expect(page.getByRole('form', { name: 'Admin sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Customer app' })).toHaveAttribute('href', `${origins.customer}/`);
    await expect(page.getByRole('link', { name: 'Business app' })).toHaveAttribute('href', `${origins.business}/`);
    await noOverflow();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('routing-isolation')), null);
    await page.reload();
    await expect(page.getByRole('form', { name: 'Admin sign in' })).toBeVisible();
    await fs.mkdir(path.join(root, 'test-results', 'app-routing'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', 'app-routing', `${name}-admin.png`), fullPage: true });
    assert.deepEqual(failures, []);
    console.log(`PASS ${name}: customer → business, sign-in/deep-link reload, invitation/signup, guestlist, admin, assets and origin isolation`);
    await context.close();
  } finally { await browser.close(); }
}

async function main() {
  if (process.argv.length > 2) throw new Error('test:app-routing accepts no environment, target URL or provider credentials.');
  const runner = createCommandRunner({ cwd: root, env: frontendBuildEnvironment() });
  try {
    for (const app of ['customer', 'business', 'admin']) await runner.npm(['run', 'build', '--workspace', `@nitewide/${app}`, '--', '--base', app === 'customer' ? '/' : `/${app}/`], {
      env: { ...frontendBuildEnvironment(), VITE_API_URL: '/api', VITE_CUSTOMER_URL: '/', VITE_BUSINESS_URL: '/business', VITE_BUSINESS_HOME: '/business' },
    });
  } finally { runner.dispose(); }
  const app = createApp({ sequelize: {}, models: {}, config, staticRoot: root, healthCheck: async () => {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const loopback = `http://127.0.0.1:${server.address().port}`;
    await checkBrowser('desktop', chromium, { viewport: { width: 1440, height: 900 } }, loopback);
    await checkBrowser('iphone', webkit, devices['iPhone 13'], loopback);
  } finally { await new Promise(resolve => server.close(resolve)); }
}
if (require.main === module) main().catch(error => {
  console.error(error.message.slice(0, 3000));
  console.error((error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n'));
  process.exitCode = 1;
});
