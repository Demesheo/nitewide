const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService, createPasswordRecord, passwordMatches, signToken, verifyToken } = require('../src/services/auth-service');
const { register } = require('../src/http/schemas');

test('passwords are stored as salted hashes and can be verified', async () => {
  const credential = await createPasswordRecord('Customer123');
  assert.notEqual(credential.passwordHash, 'Customer123');
  assert.equal(await passwordMatches('Customer123', credential), true);
  assert.equal(await passwordMatches('WrongPassword1', credential), false);
});

test('signed access tokens reject tampering and expiration', () => {
  const secret = 'test-secret-at-least-32-characters';
  const token = signToken({ sub: 'user-1', exp: 2_000_000_000 }, secret);
  assert.equal(verifyToken(token, secret, () => new Date(1_900_000_000 * 1000)).sub, 'user-1');
  assert.throws(() => verifyToken(`${token}x`, secret), (error) => error.code === 'UNAUTHENTICATED');
  assert.throws(() => verifyToken(token, secret, () => new Date(2_100_000_000 * 1000)), (error) => error.code === 'UNAUTHENTICATED');
});

test('registration normalizes an optional phone and keeps SMS choices separate', async () => {
  const input = register.parse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '(407) 555-0123', transactionalSmsConsent: true, marketingSmsConsent: false });
  assert.equal(input.phone, '+14075550123');
  assert.equal(register.parse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '' }).phone, null);
  assert.equal(register.safeParse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '', marketingSmsConsent: true }).success, false);
  assert.equal(register.safeParse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '123' }).success, false);

  let saved;
  const now = new Date('2026-09-22T12:00:00Z');
  const service = createAuthService({
    sequelize: { transaction: async (fn) => fn({}) },
    models: {
      User: { create: async (values) => { saved = values; return { id: 'user-1', ...values }; } },
      UserCredential: { create: async () => {} }, AuditLog: { create: async () => {} },
      OrganizationOwner: { findAll: async () => [] }, OrganizationEmployee: { count: async () => 0 },
      OrgAffiliate: { count: async () => 0 }, EventAffiliate: { count: async () => 0 }, Event: { count: async () => 0 },
    },
    tokenSecret: 'test-secret-at-least-32-characters', now: () => now,
  });
  const session = await service.register(input);
  assert.equal(saved.phone, '+14075550123');
  assert.equal(saved.transactionalSmsConsentAt, now);
  assert.equal(saved.marketingSmsConsentAt, null);
  assert.equal(saved.marketingConsentAt, null);
  assert.equal(session.user.phoneVerifiedAt, undefined);
});
