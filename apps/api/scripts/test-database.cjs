const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const TEST_DATABASE_PATTERN = /^nitewide_test_[0-9a-f]{32}$/;
const DEFAULT_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:5433/postgres';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function offlineEnvironment(source = process.env) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) if (key.startsWith('RESEND_')) environment[key] = '';
  for (const key of Object.keys(environment)) if (key.startsWith('STRIPE_')) environment[key] = '';
  // Blank credentials override dotenv without allowing an ambient cloud target.
  for (const key of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT']) environment[key] = '';
  return {
    ...environment,
    RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', RESEND_TEST_READ_API_KEY: '',
    RESEND_TEST_MODE: 'false', BUSINESS_GUESTLIST_REVIEW_EMAILS: 'false',
    STRIPE_MODE: 'disabled', STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_ACCOUNT_WEBHOOK_SECRET: '', STRIPE_CONNECT_CLIENT_ID:'',
    NODE_ENV: 'test', HOSTED_DEMO: 'false', LOG_LEVEL: source.LOG_LEVEL || 'silent',
    MEDIA_STORAGE_DRIVER: 'local', MEDIA_CLEANUP_ENABLED: 'false',
  };
}

function postgresUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL connection URL for the test database.');
  return url;
}

function assertLoopbackUrl(url) {
  if (!loopback.has(url.hostname)) throw new Error('Test database connections must use a loopback PostgreSQL server. Remote application/production servers are not test targets.');
  return url;
}

function maintenanceUrl(environment = process.env) {
  if (environment.TEST_DATABASE_ADMIN_URL) {
    const url = assertLoopbackUrl(postgresUrl(environment.TEST_DATABASE_ADMIN_URL));
    if (url.pathname !== '/postgres') throw new Error('TEST_DATABASE_ADMIN_URL must select the postgres maintenance database, not an application database.');
    return url.toString();
  }
  // Read only local project credentials. Never use the caller's ambient
  // DATABASE_URL or connect to the existing development/demo database.
  const envPath = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    const localValue = dotenv.parse(fs.readFileSync(envPath, 'utf8')).DATABASE_URL;
    if (localValue) {
      try {
        const url = postgresUrl(localValue);
        if (loopback.has(url.hostname) && url.port === '5433') {
          url.pathname = '/postgres';
          return url.toString();
        }
      } catch { /* An unrelated project URL never becomes the test target. */ }
    }
  }
  return DEFAULT_ADMIN_URL;
}

function assertGeneratedDatabaseName(name) {
  if (!TEST_DATABASE_PATTERN.test(name)) throw new Error('Refusing to operate on a database outside the generated nitewide_test namespace.');
  return name;
}

function assertManagedTestDatabase(environment = process.env) {
  if (environment.TEST_DATABASE_MANAGED !== '1' || environment.NODE_ENV !== 'test' || !environment.TEST_DATABASE_URL) {
    throw new Error('This integration test requires the managed isolated database. Run npm test (or npm test --workspace @nitewide/api); do not run it against development/demo data.');
  }
  const url = assertLoopbackUrl(postgresUrl(environment.TEST_DATABASE_URL));
  assertGeneratedDatabaseName(url.pathname.slice(1));
  if (environment.DATABASE_URL !== environment.TEST_DATABASE_URL) throw new Error('Managed TEST_DATABASE_URL must exactly match DATABASE_URL. Development/demo fallback is forbidden.');
  Object.assign(environment, offlineEnvironment(environment));
  return environment.TEST_DATABASE_URL;
}

module.exports = { TEST_DATABASE_PATTERN, DEFAULT_ADMIN_URL, offlineEnvironment, maintenanceUrl, postgresUrl, assertLoopbackUrl, assertGeneratedDatabaseName, assertManagedTestDatabase };
