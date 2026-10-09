const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { randomUUID, randomBytes } = require('node:crypto');
const { run, parseOptions, previewFirstAdmin, prompt } = require('../../../deploy/bootstrap-admin.cjs');
const revision = 'a'.repeat(40), email = 'first.admin@example.test';
const args = ['--environment', 'staging', '--expected-revision', revision, '--email', email];

function fixture(changes = {}) {
  const calls = [];
  const user = { id: randomUUID(), email, displayName: 'First admin', version: 0,
    isActive: true, lifecycleState: 'active', onboardingPending: false, emailVerifiedAt: null, ...changes.user };
  const transaction = {};
  const sequelize = {
    transaction: async (options, operation) => { calls.push(['transaction', options]); return operation(transaction); },
    query: async (sql, options) => { assert.equal(options.transaction, transaction); calls.push(['query', sql]); },
    close: async () => { calls.push(['close']); },
  };
  const models = {
    User: { sequelize, unscoped() { return this; }, findOne: async options => {
      assert.equal(options.transaction, transaction);
      return options.where.isInternalAdmin ? changes.existingAdmin || null : changes.missingUser ? null : user;
    } },
    AuditLog: { unscoped() { return this; }, findOne: async () => changes.audit || null },
    UserCredential: { findByPk: async (id, options) => {
      assert.equal(id, user.id); assert.equal(options.transaction, transaction);
      assert.deepEqual(options.attributes, ['userId'], 'preview never reads password material');
      return changes.missingCredential ? null : { userId: id };
    } },
  };
  return { calls, models, sequelize, user };
}

test('first-admin CLI gates explicit release identity and terminal approval before connecting, without leaking errors', async () => {
  assert.equal(parseOptions([...args.slice(0, -1), ' FIRST.ADMIN@example.test ']).email, email);
  for (const invalid of [[], [...args, '--force'], [...args, '--password', 'PrivateValue123'], [...args, '--apply'],
    [...args, '--email', email], [...args, '--help'], [...args, '--environment', 'production'],
    args.map(value => value === revision ? 'not-a-sha' : value), [...args, '--reason', 'line\nbreak']]) {
    assert.throws(() => parseOptions(invalid), { code: 'INVALID_OPTIONS' });
  }
  const { SECRET_NAMES } = require('../src/config');
  const environment = {
    NODE_ENV: 'production', APP_ENVIRONMENT: 'staging', HOSTED_DEMO: 'false', SERVE_FRONTENDS: 'true',
    DATABASE_URL: 'postgres://synthetic:PrivateDatabase123@database.example.test/nitewide_staging', DATABASE_SSL: 'true',
    MEDIA_STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'nitewide-staging-media',
    R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'PrivateR2Value123-for-offline-testing-only',
    CUSTOMER_APP_URL: 'https://staging.example.test', BUSINESS_APP_URL: 'https://staging.example.test/business',
    RENDER_GIT_COMMIT: revision, ...Object.fromEntries(SECRET_NAMES.map(name => [name, randomBytes(32).toString('hex')])),
  };
  const logs = [];
  let connections = 0;
  const blocked = { log: value => logs.push(value), createDatabase: () => { connections++; throw new Error('must-not-connect'); } };
  for (const change of [{ APP_ENVIRONMENT: 'production' }, { RENDER_GIT_COMMIT: 'b'.repeat(40) },
    { HOSTED_DEMO: 'true' }, { NODE_ENV: 'development' }, { DATABASE_URL: environment.DATABASE_URL.replace('nitewide_staging', 'nitewide_production') },
    { DEMO_RESEED_GENERATION: 'reset' }]) {
    assert.equal(await run(args, { ...blocked, environment: { ...environment, ...change } }), 1);
  }
  const apply = [...args, '--user-id', randomUUID(), '--operator', 'Authorized Operator', '--reason', 'Approved first admin setup', '--apply'];
  assert.equal(await run(apply, { ...blocked, environment, interactive: false }), 1);
  assert.equal(JSON.parse(logs.at(-1)).code, 'TTY_REQUIRED');
  assert.equal(await run(['--help'], { ...blocked, releaseConfig: () => { throw new Error('must-not-read-config'); } }), 0);
  assert.equal(await run(args, { ...blocked, releaseConfig: () => { throw new Error('PrivateDatabase123 PrivateR2Value123'); } }), 1);
  assert.equal(JSON.stringify(logs).includes('PrivateDatabase123'), false);
  assert.equal(JSON.stringify(logs).includes('PrivateR2Value123'), false);
  assert.equal(JSON.stringify(logs).includes('must-not-connect'), false);
  assert.equal(connections, 0, 'invalid release/terminal never opens a database');
});

test('first-admin previews are read-only, preserve unverified identity, close resources, and reject unavailable or previously administered accounts', async () => {
  const f = fixture(), logs = [];
  assert.equal(await run(args, { log: value => logs.push(JSON.parse(value)),
    releaseConfig: () => ({ APP_ENVIRONMENT: 'staging', RELEASE_REVISION: revision }),
    createDatabase: config => { assert.equal(config.LOG_LEVEL, 'silent'); assert.equal(config.DATABASE_POOL_MAX, 1); return f.sequelize; },
    createModels: () => f.models, prompt: () => { throw new Error('Preview must not prompt'); },
  }), 0);
  assert.equal(logs[0].readOnly, true);
  assert.equal(logs[0].target.emailVerified, false);
  assert.deepEqual(f.calls, [['transaction', { readOnly: true }], ['query', 'SET TRANSACTION READ ONLY'], ['close']]);
  for (const [changes, code] of [
    [{ audit: { id: randomUUID() } }, 'ALREADY_BOOTSTRAPPED'],
    [{ existingAdmin: { isActive: false, lifecycleState: 'archived' } }, 'ADMIN_EXISTS'],
    [{ missingUser: true }, 'ACCOUNT_UNAVAILABLE'], [{ missingCredential: true }, 'ACCOUNT_UNAVAILABLE'],
    ...[{ isActive: false }, { onboardingPending: true }, { lifecycleState: 'suspended' }, { lifecycleState: 'archived' }]
      .map(user => [{ user }, 'ACCOUNT_UNAVAILABLE']),
  ]) {
    await assert.rejects(previewFirstAdmin(fixture(changes).models, parseOptions(args)), { code });
  }
  await assert.rejects(previewFirstAdmin(f.models, { ...parseOptions(args), userId: randomUUID() }), { code: 'ACCOUNT_CHANGED' });
  const productionOptions = { ...parseOptions(args), environment: 'production' };
  await assert.rejects(previewFirstAdmin(f.models, productionOptions), { code: 'EMAIL_UNVERIFIED' });
  const verified = fixture({ user: { emailVerifiedAt: new Date() } });
  assert.equal((await previewFirstAdmin(verified.models, productionOptions)).emailVerified, true);
  const failed = fixture({ missingUser: true });
  assert.equal(await run(args, { log: () => {}, releaseConfig: () => ({ APP_ENVIRONMENT: 'staging', RELEASE_REVISION: revision }),
    createDatabase: () => failed.sequelize, createModels: () => failed.models }), 1);
  assert.deepEqual(failed.calls.at(-1), ['close']);
  const cancelled = fixture(), cancelledLogs = [];
  const apply = [...args, '--user-id', cancelled.user.id, '--operator', 'Authorized Operator', '--reason', 'Approved first admin setup', '--apply'];
  assert.equal(await run(apply, { interactive: true, log: value => cancelledLogs.push(JSON.parse(value)),
    releaseConfig: () => ({ APP_ENVIRONMENT: 'staging', RELEASE_REVISION: revision }),
    createDatabase: () => cancelled.sequelize, createModels: () => cancelled.models,
    prompt: async (_question, options) => options?.secret ? 'SyntheticPassword123' : 'Do not promote',
  }), 1);
  assert.equal(cancelledLogs.at(-1).code, 'CANCELLED');
  assert.equal(JSON.stringify(cancelledLogs).includes('SyntheticPassword123'), false);
  assert.deepEqual(cancelled.calls.at(-1), ['close']);
});

test('private terminal prompts hide passwords and cancel safely without leaving raw-mode or signal listeners', async () => {
  const input = new PassThrough(), output = new PassThrough(), modes = [], chunks = [];
  input.isTTY = output.isTTY = true; output.columns = 80;
  input.setRawMode = mode => { modes.push(mode); };
  output.on('data', chunk => chunks.push(chunk.toString()));
  const listenersBefore = process.listenerCount('SIGTERM');
  const reading = prompt('Account password: ', { secret: true, input, output });
  input.write('SyntheticPassword123\r');
  assert.equal(await reading, 'SyntheticPassword123');
  assert.equal(chunks.join(''), 'Account password: \n');
  assert.equal(process.listenerCount('SIGTERM'), listenersBefore);
  assert.equal(modes.at(-1), false);
  const cancelled = prompt('Confirm: ', { input, output });
  input.write('\x03');
  await assert.rejects(cancelled, { code: 'CANCELLED' });
  assert.equal(process.listenerCount('SIGTERM'), listenersBefore);
  assert.equal(modes.at(-1), false);
  const ended = prompt('Account password: ', { secret: true, input, output });
  input.end();
  await assert.rejects(ended, { code: 'CANCELLED' });
  assert.equal(process.listenerCount('SIGTERM'), listenersBefore);
  await assert.rejects(prompt('No pipe', { input: new PassThrough(), output }), { code: 'TTY_REQUIRED' });
});
