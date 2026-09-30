const { offlineEnvironment, maintenanceUrl, assertGeneratedDatabaseName, postgresUrl } = require('../apps/api/scripts/test-database.cjs');

// Deliberately fixed loopback targets. Never reuse the developer's apps or allow
// an environment variable to redirect mutation tests to staging/production.
const urls = { api: 'http://127.0.0.1:14100', customer: 'http://127.0.0.1:15173', business: 'http://127.0.0.1:15174', admin: 'http://127.0.0.1:15175' };
const controlToken = 'nitewide-isolated-playwright-control';
function isolatedEnvironment(databaseUrl, source = process.env) {
  return { ...offlineEnvironment(source), DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
    TEST_DATABASE_MANAGED: '1', DATABASE_SSL: 'false', DATABASE_SSL_CA: '', DATABASE_SSL_CA_FILE: '',
    AUTH_TOKEN_SECRET: 'playwright-session-key-not-for-real-environments',
    QR_TOKEN_SECRET: 'playwright-qr-key-not-for-real-environments',
    EMAIL_ENCRYPTION_KEY: 'playwright-email-key-not-for-real-environments',
    CUSTOMER_APP_URL: urls.customer, BUSINESS_APP_URL: `${urls.business}/app`,
    VITE_API_URL: '/api', VITE_CUSTOMER_URL: urls.customer, VITE_BUSINESS_URL: urls.business,
    NITEWIDE_API_PROXY: urls.api, CORS_ORIGINS: [urls.customer, urls.business, urls.admin].join(','),
  };
}
function databaseSettings(source = process.env, nonce = require('node:crypto').randomUUID()) {
  const name = assertGeneratedDatabaseName(`nitewide_test_${nonce.replaceAll('-', '')}`);
  const adminUrl = maintenanceUrl(source);
  const url = postgresUrl(adminUrl); url.pathname = `/${name}`;
  return { name, adminUrl, databaseUrl: url.toString() };
}
module.exports = { urls, controlToken, isolatedEnvironment, databaseSettings };
