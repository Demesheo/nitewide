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
