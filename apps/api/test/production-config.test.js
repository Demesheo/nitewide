const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { getConfig, DEVELOPMENT_SECRETS, SECRET_NAMES } = require('../src/config');
const { createSequelize } = require('../src/db/sequelize');
const { databaseConnectionConfig } = require('../src/db/connection-config');
const { signToken, verifyToken } = require('../src/services/auth-service');
const { walletToken, verifyWalletToken, guestlistWalletToken, verifyGuestlistWalletToken } = require('../src/domain/wallet-qr');
const { encryptVariables, decryptVariables } = require('../src/services/email-service');
const { generateSecrets, main: generate } = require('../../../scripts/generate-secrets.cjs');

const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://app:password@database.example/nitewide', DATABASE_SSL: 'true',
  ...Object.fromEntries(SECRET_NAMES.map(name => [name, randomBytes(32).toString('hex')])) };

test('regular release configuration isolates staging/production, bounds pools and refuses demo startup', async () => {
  const { releaseConfig, main } = require('../../../deploy/run.cjs');
  for (const APP_ENVIRONMENT of ['staging', 'production']) {
    const environment = { ...production, APP_ENVIRONMENT, HOSTED_DEMO: 'false', SERVE_FRONTENDS: 'true',
      DATABASE_URL: `postgres://app:password@database.example/nitewide_${APP_ENVIRONMENT}`, DATABASE_POOL_MAX: '4',
      MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: `nitewide-${APP_ENVIRONMENT}-media`,
      R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret-key-for-offline-tests',
      CUSTOMER_APP_URL: `https://${APP_ENVIRONMENT}.example.test`, BUSINESS_APP_URL: `https://${APP_ENVIRONMENT}.example.test/app`,
      RENDER_GIT_COMMIT: 'a'.repeat(40) };
    const config = releaseConfig(environment);
    assert.equal(config.serveFrontends, true);
    assert.equal(config.hostedDemo, false);
    assert.equal(config.databaseTls.rejectUnauthorized, true);
    const db = createSequelize(config);
    assert.equal(db.options.pool.max, 4);
    await db.close();
    for (const invalid of [
      { NODE_ENV: 'test' }, { HOSTED_DEMO: 'true' }, { DEMO_RESEED_GENERATION: 'unexpected-reset' },
      { APP_ENVIRONMENT: undefined }, { DATABASE_SSL: 'false' }, { MEDIA_STORAGE_DRIVER: 'local' },
      { R2_BUCKET: 'nitewide-dev-media' }, { R2_BUCKET: `nitewide-${APP_ENVIRONMENT === 'staging' ? 'production' : 'staging'}-media` },
      { DATABASE_URL: 'postgres://app:password@database.example/nitewide_demo' },
      { DATABASE_URL: `postgres://app:password@database.example/nitewide_${APP_ENVIRONMENT === 'staging' ? 'production' : 'staging'}` },
      { CUSTOMER_APP_URL: undefined }, { BUSINESS_APP_URL: undefined }, { CUSTOMER_APP_URL: 'http://localhost:5173' },
      { BUSINESS_APP_URL: 'https://other.example.test/app' }, { BUSINESS_APP_URL: `${environment.CUSTOMER_APP_URL}/business` },
      { ADMIN_APP_URL: 'https://other.example.test/admin' }, { ADMIN_APP_URL: `${environment.CUSTOMER_APP_URL}/` },
      { CUSTOMER_APP_URL: `${environment.CUSTOMER_APP_URL}/?invite=unexpected` },
      { DATABASE_POOL_MAX: '0' }, { DATABASE_POOL_MAX: '41' }, { RENDER_GIT_COMMIT: 'not-a-sha' },
      { STRIPE_SANDBOX_SHARED_ACCOUNT_ID: 'acct_sharedfixture' }, { STRIPE_SECRET_KEY: 'sk_live_forbidden' },
    ]) assert.throws(() => releaseConfig({ ...environment, ...invalid }));
    await assert.rejects(main(['api'], { ...environment, SERVE_FRONTENDS: 'false' }), /API must enable/);
    await assert.rejects(main(['worker'], environment), /worker must disable/);
    await assert.rejects(main(['seed'], environment), /Use deploy\/run/);
    if (APP_ENVIRONMENT === 'staging') assert.throws(() => releaseConfig({ ...environment,
      CUSTOMER_APP_URL: 'https://nitewide.com', BUSINESS_APP_URL: 'https://nitewide.com/app' }), /production customer hostname/);
    const subdomains = { ...environment, APP_ROUTING_MODE: 'subdomains',
      CUSTOMER_APP_URL: `https://${APP_ENVIRONMENT}.nitewide.test`, BUSINESS_APP_URL: `https://business-${APP_ENVIRONMENT}.nitewide.test/app`,
      ADMIN_APP_URL: `https://admin-${APP_ENVIRONMENT}.nitewide.test`,
      CORS_ORIGINS: `https://${APP_ENVIRONMENT}.nitewide.test,https://business-${APP_ENVIRONMENT}.nitewide.test,https://admin-${APP_ENVIRONMENT}.nitewide.test` };
    assert.equal(releaseConfig(subdomains).APP_ROUTING_MODE, 'subdomains');
    for (const invalid of [
      { APP_ROUTING_MODE: 'unknown' }, { ADMIN_APP_URL: undefined }, { ADMIN_APP_URL: '' },
      { ADMIN_APP_URL: 'https://localhost' }, { ADMIN_APP_URL: subdomains.CUSTOMER_APP_URL },
      { ADMIN_APP_URL: 'https://invalid_host.example.test' }, { ADMIN_APP_URL: 'https://admin.example.test.' },
      { ADMIN_APP_URL: `${subdomains.ADMIN_APP_URL}/admin` }, { BUSINESS_APP_URL: `${subdomains.BUSINESS_APP_URL}/` },
      { CUSTOMER_APP_URL: `${subdomains.CUSTOMER_APP_URL}/app` }, { ADMIN_APP_URL: `${subdomains.ADMIN_APP_URL}?secret=not-public` },
      { ADMIN_APP_URL: `${subdomains.ADMIN_APP_URL}#fragment` }, { ADMIN_APP_URL: 'https://user:password@admin.nitewide.test' },
      { CORS_ORIGINS: '*' }, { CORS_ORIGINS: subdomains.CUSTOMER_APP_URL }, { CORS_ORIGINS: `${subdomains.CORS_ORIGINS},https://invalid.test/path` },
      { CUSTOMER_APP_URL: `${subdomains.CUSTOMER_APP_URL}:8443` },
    ]) assert.throws(() => releaseConfig({ ...subdomains, ...invalid }));
    if (APP_ENVIRONMENT === 'staging') for (const [key, value] of [['BUSINESS_APP_URL', 'https://business.nitewide.com/app'], ['ADMIN_APP_URL', 'https://admin.nitewide.com']]) {
      const crossEnvironment = { ...subdomains, [key]: value };
      crossEnvironment.CORS_ORIGINS = ['CUSTOMER_APP_URL', 'BUSINESS_APP_URL', 'ADMIN_APP_URL'].map(name => new URL(crossEnvironment[name]).origin).join(',');
      assert.throws(() => releaseConfig(crossEnvironment), /production app hostnames/);
    }
  }
  assert.throws(() => getConfig({ ...production, SERVE_FRONTENDS: 'true' }), /explicit staging\/production/);
  const offline = require('../scripts/test-database.cjs').offlineEnvironment({ APP_ENVIRONMENT: 'production', APP_ROUTING_MODE: 'subdomains', ADMIN_APP_URL: 'https://admin.nitewide.com', SERVE_FRONTENDS: 'true' });
  assert.equal(offline.APP_ENVIRONMENT, '');
  assert.equal(offline.SERVE_FRONTENDS, 'false');
  assert.equal(offline.APP_ROUTING_MODE, 'paths');
  assert.equal(offline.ADMIN_APP_URL, '');
});

test('release migrations hold the lock, never seed, and close it on CLI failure or interruption', async () => {
  const { EventEmitter } = require('node:events');
  const { migrate } = require('../../../deploy/migrate.cjs');
  const config = getConfig(production);
  for (const outcome of ['success', 'connect-failed', 'lock-failed', 'cli-failed', 'spawn-failed', 'interrupted']) {
    const actions = [], signals = new EventEmitter();
    class ClientClass {
      constructor(options) {
        assert.equal(options.connectionString, config.DATABASE_URL);
        assert.equal(options.ssl.rejectUnauthorized, true);
        assert.equal(options.lock_timeout, 10000);
      }
      async connect() {
        actions.push('connect');
        if (outcome === 'connect-failed') throw new Error('offline connection failed');
      }
      async query(sql) {
        actions.push('lock');
        assert.equal(sql, 'SELECT pg_advisory_lock(721092301)');
        if (outcome === 'lock-failed') throw new Error('offline lock failed');
      }
      async end() { actions.push('close'); }
    }
    const spawnProcess = (command, args, options) => {
      actions.push('migrate');
      assert.equal(command, process.execPath);
      assert.deepEqual(args.slice(1), ['db:migrate', '--env', 'production']);
      assert.equal(options.cwd, path.resolve(__dirname, '..'));
      const child = new EventEmitter();
      child.kill = signal => {
        assert.equal(signal, 'SIGTERM');
        actions.push('terminate');
        queueMicrotask(() => child.emit('close', null));
      };
      queueMicrotask(() => {
        if (outcome === 'spawn-failed') child.emit('error', new Error('offline spawn failed'));
        else if (outcome === 'interrupted') signals.emit('SIGTERM');
        else child.emit('close', outcome === 'success' ? 0 : 1);
      });
      return child;
    };
    const run = migrate(config, { ClientClass, spawnProcess, signals });
    if (outcome === 'success') await run;
    else await assert.rejects(run);
    assert.equal(actions.at(-1), 'close', outcome);
    assert.ok(!actions.includes('migrate') || actions.indexOf('lock') < actions.indexOf('migrate'));
    if (outcome === 'interrupted') assert.ok(actions.includes('terminate'));
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  }
});

test('hosted Stripe requires explicit HTTPS public return URLs even without email or checkout webhooks', () => {
  const stripe = { ...production, STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_offlinefixture',
    CUSTOMER_APP_URL: 'https://customer.example.test', BUSINESS_APP_URL: 'https://business.example.test/app' };
  for (const HOSTED_DEMO of ['false', 'true']) {
    const environment = { ...stripe, HOSTED_DEMO };
    const configured = getConfig(environment);
    assert.equal(configured.CUSTOMER_APP_URL, stripe.CUSTOMER_APP_URL);
    assert.equal(configured.businessAppUrl, stripe.BUSINESS_APP_URL);
    assert.equal(configured.RESEND_API_KEY, undefined);
    assert.equal(configured.STRIPE_WEBHOOK_SECRET, undefined,'onboarding URL checks apply before paid checkout enablement');
    for (const name of ['CUSTOMER_APP_URL', 'BUSINESS_APP_URL']) {
      for (const value of [undefined, '', 'not-a-url', 'http://public.example.test/app', 'https://localhost/app',
        'https://LOCALHOST./app', 'https://dev.localhost/app', 'https://server.local/app', 'https://api.internal/app',
        'https://server/app', 'https://127.0.0.1/app', 'https://127.1/app', 'https://2130706433/app',
        'https://0.0.0.0/app', 'https://10.0.0.1/app', 'https://172.16.0.1/app', 'https://192.168.1.1/app',
        'https://169.254.1.1/app', 'https://100.64.0.1/app', 'https://[::1]/app', 'https://[::]/app',
        'https://[fc00::1]/app', 'https://[fe80::1]/app', 'https://[::ffff:127.0.0.1]/app',
        'https://user:password@public.example.test/app']) {
        assert.throws(() => getConfig({ ...environment, [name]: value }), new RegExp(`explicit HTTPS public ${name}`));
      }
    }
    assert.throws(() => getConfig({ ...environment, BUSINESS_APP_URL: undefined }), /BUSINESS_APP_URL/,'hosted business callbacks must not silently derive from the customer app');
  }
});

test('local Stripe keeps localhost return URLs and offline hosted tests retain disabled payment defaults', () => {
  for (const NODE_ENV of ['development','test']) {
    const local = getConfig({ NODE_ENV, STRIPE_MODE:'test', STRIPE_SECRET_KEY:'sk_test_offlinefixture' });
    assert.equal(local.CUSTOMER_APP_URL,'http://localhost:5173');assert.equal(local.businessAppUrl,'http://localhost:5174/app');
    assert.equal(getConfig({ NODE_ENV, STRIPE_MODE:'test', STRIPE_SECRET_KEY:'sk_test_offlinefixture',
      CUSTOMER_APP_URL:'http://127.0.0.1:5173', BUSINESS_APP_URL:'http://localhost:5174/app' }).businessAppUrl,'http://localhost:5174/app');
  }
  assert.equal(getConfig({ ...production, HOSTED_DEMO:'true' }).STRIPE_MODE,'disabled');
  assert.equal(getConfig({ ...production, HOSTED_DEMO:'true' }).businessAppUrl,'http://localhost:5173/app');
});

test('proxy headers are not trusted by default and only bounded explicit hop counts are accepted', () => {
  assert.equal(getConfig({}).trustProxy, false);
  assert.equal(getConfig(production).trustProxy, false);
  assert.equal(getConfig({ ...production, HOSTED_DEMO: 'true' }).trustProxy, 1);
  assert.equal(getConfig({ TRUST_PROXY_HOPS: '0' }).trustProxy, 0);
  assert.equal(getConfig({ TRUST_PROXY_HOPS: '1' }).trustProxy, 1);
  for (const value of ['true', '-1', '6', '1.5']) assert.throws(() => getConfig({ TRUST_PROXY_HOPS: value }));
});

test('every production mode requires explicit distinct secrets and rejects development/example defaults', () => {
  for (const HOSTED_DEMO of ['false', 'true']) {
    for (const name of SECRET_NAMES) {
      for (const value of [undefined, DEVELOPMENT_SECRETS[name], DEVELOPMENT_SECRETS.AUTH_TOKEN_SECRET, 'replace-this-with-at-least-32-random-characters']) {
        assert.throws(() => getConfig({ ...production, HOSTED_DEMO, [name]: value }));
      }
    }
    assert.throws(() => getConfig({ ...production, HOSTED_DEMO, QR_TOKEN_SECRET: production.AUTH_TOKEN_SECRET }), /different keys/);
    assert.equal(getConfig({ ...production, HOSTED_DEMO }).hostedDemo, HOSTED_DEMO === 'true');
  }
});

test('production requires an explicit database and verified TLS; development and the hosted private demo can use plaintext', () => {
  assert.throws(() => getConfig({ ...production, DATABASE_URL: undefined }), /explicit DATABASE_URL/);
  for (const DATABASE_SSL of [undefined, 'false']) assert.throws(() => getConfig({ ...production, DATABASE_SSL }), /verified database TLS/);
  assert.throws(() => getConfig({ ...production, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /cannot be disabled/);
  assert.equal(getConfig({}).databaseTls, false);
  assert.equal(getConfig({ ...production, HOSTED_DEMO: 'true', DATABASE_SSL: 'false' }).databaseTls, false);
  const db = createSequelize(getConfig(production));
  assert.equal(db.options.dialectOptions.ssl.rejectUnauthorized, true);
});

test('connection URL parameters cannot weaken verification or replace the TLS object', () => {
  for (const option of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=require', 'sslmode=verify-ca', 'ssl=false', 'sslrootcert=/tmp/ca', 'sslcert=/tmp/client', 'sslkey=/tmp/key', 'sslnegotiation=direct', 'sslmode=verify-full&sslmode=no-verify']) {
    assert.throws(() => databaseConnectionConfig({ ...production, DATABASE_URL: `${production.DATABASE_URL}?${option}` }), /TLS options/);
  }
  const config = databaseConnectionConfig({ ...production, DATABASE_URL: `${production.DATABASE_URL}?sslmode=verify-full&application_name=nitewide` });
  assert.equal(new URL(config.databaseUrl).searchParams.has('sslmode'), false);
  assert.equal(new URL(config.databaseUrl).searchParams.get('application_name'), 'nitewide');
  assert.equal(config.databaseTls.rejectUnauthorized, true);
  assert.equal(config.databaseTls.checkServerIdentity, undefined, 'Node performs its default hostname validation');
  assert.throws(() => databaseConnectionConfig({ ...production, DATABASE_SSL_CA: 'not-a-certificate' }), /PEM/);
  assert.throws(() => databaseConnectionConfig({ ...production, DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----' }), /invalid certificate/);
  assert.throws(() => databaseConnectionConfig({ ...production, DATABASE_SSL_CA: 'ca', DATABASE_SSL_CA_FILE: '/tmp/ca' }), /not both/);
});

test('production migrations enforce TLS independently of application signing configuration', () => {
  const config = require('../src/db/config.cjs');
  const before = Object.fromEntries(['DATABASE_SSL', 'HOSTED_DEMO', 'DATABASE_URL'].map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, { DATABASE_URL: production.DATABASE_URL, DATABASE_SSL: 'false', HOSTED_DEMO: 'false' });
    assert.throws(() => config.production, /verified database TLS/);
    process.env.DATABASE_SSL = 'true';
    assert.equal(config.production.dialectOptions.ssl.rejectUnauthorized, true);
  } finally {
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('rotating a key affects only its own session, QR or encrypted-email artifacts', () => {
  const config = getConfig(production);
  const session = signToken({ sub: 'customer', exp: 2_000_000_000 }, config.AUTH_TOKEN_SECRET);
  const ticket = { id: 'ticket', eventId: 'event', holderUserId: 'customer', qrTokenHash: 'hash' };
  const entry = { id: 'entry', eventId: 'event', userId: 'customer', partySize: 2, qrTokenHash: 'hash' };
  const qr = walletToken(ticket, config.QR_TOKEN_SECRET);
  const guestQr = guestlistWalletToken(entry, config.QR_TOKEN_SECRET);
  const variables = { NAME: 'Guest', BOOKING_URL: 'https://nitewide.example/?booking=123' };
  const encrypted = encryptVariables(variables, config.EMAIL_ENCRYPTION_KEY);
  for (const rotated of SECRET_NAMES) {
    const keys = getConfig({ ...production, [rotated]: randomBytes(32).toString('hex') });
    if (rotated === 'AUTH_TOKEN_SECRET') assert.throws(() => verifyToken(session, keys.AUTH_TOKEN_SECRET), { code: 'UNAUTHENTICATED' });
    else assert.equal(verifyToken(session, keys.AUTH_TOKEN_SECRET).sub, 'customer');
    assert.equal(verifyWalletToken(qr, ticket, keys.QR_TOKEN_SECRET), rotated !== 'QR_TOKEN_SECRET');
    assert.equal(verifyGuestlistWalletToken(guestQr, entry, keys.QR_TOKEN_SECRET), rotated !== 'QR_TOKEN_SECRET');
    if (rotated === 'EMAIL_ENCRYPTION_KEY') assert.throws(() => decryptVariables(encrypted, keys.EMAIL_ENCRYPTION_KEY));
    else assert.deepEqual(decryptVariables(encrypted, keys.EMAIL_ENCRYPTION_KEY), variables);
  }
});

test('a provider CA is loaded from PEM text or a mounted file with verification still enabled', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nitewide-ca-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'ca.pem');
  const ca = require('node:tls').rootCertificates[0];
  writeFileSync(filename, ca);
  for (const settings of [{ DATABASE_SSL_CA_FILE: filename }, { DATABASE_SSL_CA: ca.replaceAll('\n', '\\n') }]) {
    const config = databaseConnectionConfig({ ...production, ...settings });
    assert.equal(config.databaseTls.ca, ca);
    assert.equal(config.databaseTls.rejectUnauthorized, true);
  }
});

test('secret initialization preserves existing keys and environment settings and never overwrites a generated secret file', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nitewide-secret-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, '.env');
  const existing = randomBytes(32).toString('hex');
  writeFileSync(filename, `NODE_ENV=development\nRESEND_API_KEY=unchanged\nAUTH_TOKEN_SECRET=${existing}\n`);
  generate(['--env-file', filename]);
  const values = require('dotenv').parse(readFileSync(filename));
  assert.equal(values.RESEND_API_KEY, 'unchanged');
  assert.equal(values.AUTH_TOKEN_SECRET, existing);
  assert.equal(new Set(SECRET_NAMES.map(name => values[name])).size, 3);
  generate(['--env-file', filename]);
  assert.deepEqual(require('dotenv').parse(readFileSync(filename)), values);
  const output = path.join(directory, '.env.secrets');
  generate(['--output', output]);
  assert.throws(() => generate(['--output', output]), { code: 'EEXIST' });
  assert.deepEqual(generateSecrets(values), Object.fromEntries(SECRET_NAMES.map(name => [name, values[name]])));
});
