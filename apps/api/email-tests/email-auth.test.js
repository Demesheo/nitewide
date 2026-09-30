const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService, createPasswordRecord, passwordMatches } = require('../src/services/auth-service');
const { TEMPLATES } = require('../src/services/email-templates');

function fixture() {
  let clock = new Date('2026-09-26T12:00:00Z');
  const user = {
    id: 'user-1', email: 'guest@example.org', displayName: 'Guest One', isActive: true,
    emailVerifiedAt: null,
    async update(values) { Object.assign(this, values); },
  };
  const credential = { ...(createPasswordRecord), passwordChangedAt: clock };
  const tokens = [];
  const queued = [];
  const models = {
    AuthSession: { create: async (values) => ({ id: 'e70aafec-c0e2-45b0-aeb9-15618352089e', ...values }), findByPk: async () => ({ id: 'e70aafec-c0e2-45b0-aeb9-15618352089e', userId: user.id, expiresAt: new Date(clock.getTime() + 3600000) }) },
    User: {
      findOne: async ({ where }) => where.email === user.email && user.isActive ? user : null,
      findByPk: async (id) => id === user.id ? user : null,
    },
    UserCredential: {
      findByPk: async () => credential,
      update: async (values) => { Object.assign(credential, values); },
    },
    UserActionToken: {
      count: async ({ where }) => tokens.filter((row) => row.userId === where.userId && row.purpose === where.purpose && row.createdAt >= where.createdAt[Object.getOwnPropertySymbols(where.createdAt)[0]]).length,
      create: async (values) => {
        const row = { id: `token-${tokens.length + 1}`, ...values, createdAt: clock, consumedAt: null, async update(updates) { Object.assign(this, updates); } };
        tokens.push(row); return row;
      },
      findOne: async ({ where }) => tokens.find((row) => row.tokenHash === where.tokenHash && row.purpose === where.purpose),
    },
    OrganizationOwner: { findAll: async () => [] },
    OrganizationEmployee: { count: async () => 0 },
    OrgAffiliate: { count: async () => 0 },
    EventAffiliate: { count: async () => 0 },
    Event: { count: async () => 0 },
  };
  const email = { enabled: true, queue: async (message) => { queued.push(message); } };
  const auth = createAuthService({
    sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) },
    models, tokenSecret: 'test-secret-at-least-32-characters',
    email, customerAppUrl: 'https://nitewide.example', now: () => clock,
  });
  return { auth, user, credential, tokens, queued, advance: () => { clock = new Date(clock.getTime() + 61000); } };
}

test('email verification is single-use, bound to the address, and releases welcome only afterward', async () => {
  const f = fixture();
  await f.auth.requestEmailVerification('user-1');
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].template, TEMPLATES.verifyEmail);
  assert.equal(f.queued.some((row) => row.template === TEMPLATES.welcome), false);
  const token = new URL(f.queued[0].variables.VERIFY_URL).searchParams.get('verifyEmail');
  assert.ok(token);
  assert.deepEqual(await f.auth.verifyEmail(token), { verified: true });
  assert.ok(f.user.emailVerifiedAt);
  assert.equal(f.queued[1].template, TEMPLATES.welcome);
  await assert.rejects(() => f.auth.verifyEmail(token), (error) => error.code === 'ACTION_TOKEN_INVALID');
});

test('password reset does not reveal account existence, requires a single-use link, and invalidates earlier sessions', async () => {
  const f = fixture();
  Object.assign(f.credential, await createPasswordRecord('Previous123'));
  const oldSession = await f.auth.signIn({ email: f.user.email, password: 'Previous123' });
  const unknown = await f.auth.requestPasswordReset('missing@example.org');
  const known = await f.auth.requestPasswordReset(f.user.email);
  assert.deepEqual(known, unknown);
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].template, TEMPLATES.passwordReset);
  const token = new URL(f.queued[0].variables.RESET_URL).searchParams.get('resetPassword');
  f.advance();
  await f.auth.resetPassword(token, 'NewPassword123');
  assert.equal(await passwordMatches('NewPassword123', f.credential), true);
  await assert.rejects(() => f.auth.authenticate(oldSession.accessToken), (error) => error.code === 'UNAUTHENTICATED');
  await assert.rejects(() => f.auth.resetPassword(token, 'AnotherPassword123'), (error) => error.code === 'ACTION_TOKEN_INVALID');
});

test('verification link for an old email cannot verify a changed address', async () => {
  const f = fixture();
  await f.auth.requestEmailVerification('user-1');
  const token = new URL(f.queued[0].variables.VERIFY_URL).searchParams.get('verifyEmail');
  f.user.email = 'changed@example.org';
  await assert.rejects(() => f.auth.verifyEmail(token), (error) => error.code === 'ACTION_TOKEN_INVALID');
  assert.equal(f.user.emailVerifiedAt, null);
});
