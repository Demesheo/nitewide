const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseSettings, isolatedEnvironment, urls } = require('../../../e2e/environment.cjs');
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
  const env = isolatedEnvironment(url, { RESEND_API_KEY: 'never-send', RESEND_TEST_READ_API_KEY: 'never-read', RESEND_UNKNOWN_KEY: 'never-use', NODE_ENV: 'production', HOSTED_DEMO: 'true', DATABASE_URL: 'remote', DATABASE_SSL: 'true', DATABASE_SSL_CA: 'production-ca', NITEWIDE_API_PROXY: 'https://live.example' });
  assert.equal(assertManagedTestDatabase(env), url);
  for (const [key, value] of Object.entries(env)) if (key.startsWith('RESEND_') && key !== 'RESEND_TEST_MODE') assert.equal(value, '', key);
  assert.equal(env.RESEND_TEST_MODE, 'false');
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

test('Playwright runner preserves target and sequential fixture isolation', () => {
  const valid = ['--project=customer-iphone', '--grep', 'booking', '--headed'];
  assert.deepEqual(validateArguments(valid), valid);
  for (const value of ['--config=production.cjs', '-c', '-cproduction.cjs', '--workers=4', '-j', '-j4', '--fully-parallel', '--repeat-each=5', '--output=/unsafe']) {
    assert.throws(() => validateArguments([value]));
  }
});
