const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseSettings, isolatedEnvironment, frontendBuildEnvironment, urls } = require('../../../e2e/environment.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { validateArguments } = require('../../../e2e/run.cjs');

test('Playwright cannot select a remote or application database for maintenance', () => {
  for (const value of ['postgres://user:pass@production.example/postgres', 'postgres://user:pass@localhost:5433/nitewide']) {
    assert.throws(() => databaseSettings({ TEST_DATABASE_ADMIN_URL: value }));
  }
  const settings = databaseSettings({ TEST_DATABASE_ADMIN_URL: 'postgres://test:fake@localhost:5433/postgres', DATABASE_URL: 'postgres://live:secret@production.example/nitewide' }, '00000000-0000-4000-8000-000000000099');
  assert.equal(new URL(settings.databaseUrl).pathname, '/nitewide_test_00000000000040008000000000000099');
  assert.equal(new URL(settings.databaseUrl).hostname, 'localhost');
  assert.throws(() => databaseSettings({}, 'not-a-uuid'));
});

test('Playwright isolates URLs, secrets, email quota and database SSL from ambient configuration', () => {
  const url = 'postgres://test:fake@127.0.0.1:5433/nitewide_test_00000000000040008000000000000099';
  const env = isolatedEnvironment(url, { RESEND_API_KEY: 'never-send', RESEND_TEST_READ_API_KEY: 'never-read', RESEND_UNKNOWN_KEY: 'never-use', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'real-media', R2_ACCESS_KEY_ID: 'never-write', R2_SECRET_ACCESS_KEY: 'never-write', MEDIA_STORAGE_DRIVER: 'r2', MEDIA_CLEANUP_ENABLED: 'true', NODE_ENV: 'production', HOSTED_DEMO: 'true', DATABASE_URL: 'remote', DATABASE_SSL: 'true', DATABASE_SSL_CA: 'production-ca', NITEWIDE_API_PROXY: 'https://live.example' });
  assert.equal(assertManagedTestDatabase(env), url);
  for (const [key, value] of Object.entries(env)) if (key.startsWith('RESEND_') && key !== 'RESEND_TEST_MODE') assert.equal(value, '', key);
  assert.equal(env.RESEND_TEST_MODE, 'false');
  assert.equal(env.R2_ACCESS_KEY_ID, ''); assert.equal(env.R2_SECRET_ACCESS_KEY, '');
  assert.equal(env.MEDIA_STORAGE_DRIVER, 'local'); assert.equal(env.MEDIA_CLEANUP_ENABLED, 'false');
  assert.equal(env.NODE_ENV, 'test'); assert.equal(env.HOSTED_DEMO, 'false');
  assert.equal(env.NITEWIDE_API_PROXY, urls.api);
  assert.equal(env.DATABASE_SSL, 'false'); assert.equal(env.DATABASE_SSL_CA, '');
  assert.equal(new Set([env.AUTH_TOKEN_SECRET, env.QR_TOKEN_SECRET, env.EMAIL_ENCRYPTION_KEY]).size, 3);
  for (const value of Object.values(urls)) assert.equal(new URL(value).hostname, '127.0.0.1');
});

test('Playwright database guards reject mismatched or non-generated targets', () => {
  const databaseUrl = 'postgres://test:fake@127.0.0.1:5433/nitewide_test_00000000000040008000000000000099';
  assert.throws(() => assertManagedTestDatabase({ ...isolatedEnvironment(databaseUrl, {}), DATABASE_URL: 'postgres://test:fake@localhost/nitewide' }));
  assert.throws(() => assertManagedTestDatabase(isolatedEnvironment('postgres://test:fake@localhost/nitewide', {})));
});

test('browser frontends build in production mode without production credentials or API/database targets', () => {
  const source = { NODE_ENV: 'test', DATABASE_URL: 'postgres://live:secret@production.example/nitewide',
    RESEND_API_KEY: 'never-send', RESEND_UNKNOWN_KEY: 'never-use', R2_ACCESS_KEY_ID: 'never-write', R2_SECRET_ACCESS_KEY: 'never-write',
    MEDIA_STORAGE_DRIVER: 'r2', MEDIA_CLEANUP_ENABLED: 'true', HOSTED_DEMO: 'true', NITEWIDE_API_PROXY: 'https://live.example', VITE_API_URL: 'https://live.example/api' };
  const build = frontendBuildEnvironment(source);
  const runtime = isolatedEnvironment('postgres://test:fake@127.0.0.1:5433/nitewide_test_00000000000040008000000000000099', source);
  assert.equal(build.NODE_ENV, 'production');
  assert.equal(runtime.NODE_ENV, 'test');
  assert.equal(source.NODE_ENV, 'test', 'creating the build environment must not mutate the runtime source');
  assert.equal(new URL(build.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(build.DATABASE_URL).port, '1', 'builds cannot accidentally use the test or developer database');
  assert.equal(build.TEST_DATABASE_URL, build.DATABASE_URL);
  assert.equal(build.VITE_API_URL, '/api');
  assert.equal(build.NITEWIDE_API_PROXY, urls.api);
  assert.equal(build.HOSTED_DEMO, 'false');
  assert.equal(build.MEDIA_STORAGE_DRIVER, 'local');
  assert.equal(build.MEDIA_CLEANUP_ENABLED, 'false');
  for (const [key, value] of Object.entries(build)) if (key.startsWith('RESEND_') && key !== 'RESEND_TEST_MODE') assert.equal(value, '', key);
  assert.equal(build.R2_ACCESS_KEY_ID, '');
  assert.equal(build.R2_SECRET_ACCESS_KEY, '');
});

test('Playwright runner preserves target and sequential fixture isolation', () => {
  const valid = ['--project=customer-iphone', '--grep', 'booking', '--headed'];
  assert.deepEqual(validateArguments(valid), valid);
  for (const value of ['--config=production.cjs', '-c', '-cproduction.cjs', '--workers=4', '-j', '-j4', '--fully-parallel', '--repeat-each=5', '--output=/unsafe']) {
    assert.throws(() => validateArguments([value]));
  }
});
