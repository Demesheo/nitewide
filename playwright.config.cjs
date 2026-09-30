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
  timeout: 45000, expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/e2e.xml' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure',
    actionTimeout: 10000, navigationTimeout: 15000, timezoneId: 'America/New_York', locale: 'en-US', reducedMotion: 'reduce', serviceWorkers: 'block' },
  projects: ['customer', 'business', 'admin'].flatMap(app => [
    { name: `${app}-iphone`, testMatch: `${app}.spec.cjs`, use: { ...devices['iPhone 13'], browserName: 'webkit', baseURL: urls[app] } },
    { name: `${app}-desktop`, testMatch: `${app}.spec.cjs`, use: { ...devices['Desktop Chrome'], baseURL: urls[app] } },
  ]),
  webServer: { command: 'node e2e/server.cjs', url: urls.admin, reuseExistingServer: false, timeout: 120000,
    env: isolatedEnvironment('postgres://test:test@127.0.0.1:1/nitewide_unused'),
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 }, stdout: 'pipe', stderr: 'pipe' },
});
