const { defineConfig, devices } = require('@playwright/test');
const { urls, isolatedEnvironment } = require('./e2e/environment.cjs');

module.exports = defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  // Each test reseeds the one disposable database. Never run mutation tests
  // concurrently against it; parallel workers require per-worker databases.
  workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  // Stop a broken job after three exhausted test failures rather than repeat
  // the same setup failure for minutes. Any unexecuted tests still block release.
  maxFailures: process.env.CI ? 3 : 0,
  timeout: 45000, expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/e2e.xml' }], ['./e2e/timing-reporter.cjs']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure',
    actionTimeout: 10000, navigationTimeout: 15000, timezoneId: 'America/New_York', locale: 'en-US', reducedMotion: 'reduce', serviceWorkers: 'block' },
  // Rebuilt admin workflows have dedicated interaction coverage; the obsolete,
  // previously unselected legacy spec has been retired.
  projects: [...['customer', 'business'].flatMap(app => [
    { name: `${app}-iphone`, testMatch: app === 'business' ? ['business.spec.cjs', 'business-access.spec.cjs', 'business-payments.spec.cjs','commissions-messages.spec.cjs'] : ['customer.spec.cjs', 'customer-my-events.spec.cjs','commissions-messages.spec.cjs'], use: { ...devices['iPhone 13'], browserName: 'webkit', baseURL: urls[app] } },
    { name: `${app}-desktop`, testMatch: app === 'business' ? ['business.spec.cjs', 'business-access.spec.cjs', 'business-payments.spec.cjs','commissions-messages.spec.cjs'] : ['customer.spec.cjs', 'customer-my-events.spec.cjs','commissions-messages.spec.cjs'], use: { ...devices['Desktop Chrome'], baseURL: urls[app] } },
  ]),
    { name: 'admin-rebuild-iphone', testMatch: ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs'], use: { ...devices['iPhone 13'], browserName: 'webkit', baseURL: urls.admin } },
    { name: 'admin-rebuild-desktop', testMatch: ['admin-rebuild.spec.cjs', 'admin-access-requests.spec.cjs'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: urls.admin } },
  ],
  webServer: { command: 'node e2e/server.cjs', url: urls.admin, reuseExistingServer: false, timeout: 120000,
    env: isolatedEnvironment('postgres://test:test@127.0.0.1:1/nitewide_unused'),
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 }, stdout: 'pipe', stderr: 'pipe' },
});
