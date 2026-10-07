const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService, createPasswordRecord, passwordMatches, signToken, verifyToken } = require('../src/services/auth-service');
const { register } = require('../src/http/schemas');
const { TERMS_VERSION, documentSha256 } = require('../src/domain/terms-acceptance');
const agreement = { termsAccepted: true, termsVersion: TERMS_VERSION };

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
  assert.throws(() => verifyToken(`${token}.extra`, secret), (error) => error.code === 'UNAUTHENTICATED');
  assert.throws(() => verifyToken(signToken({ sub: 'user-1', exp: 'not-a-date' }, secret), secret), (error) => error.code === 'UNAUTHENTICATED');
  assert.throws(() => verifyToken(token, secret, () => new Date(2_100_000_000 * 1000)), (error) => error.code === 'UNAUTHENTICATED');
});

test('registration normalizes an optional phone and keeps SMS choices separate', async () => {
  const input = register.parse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '(407) 555-0123', transactionalSmsConsent: true, marketingSmsConsent: false, ...agreement });
  assert.equal(input.phone, '+14075550123');
  assert.equal(register.parse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '', ...agreement }).phone, null);
  assert.equal(register.safeParse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '', marketingSmsConsent: true, ...agreement }).success, false);
  assert.equal(register.safeParse({ displayName: 'Taylor Guest', email: 'Taylor@example.com', password: 'Welcome123', phone: '123', ...agreement }).success, false);

  let saved;
  const audits = [];
  const now = new Date('2026-09-22T12:00:00Z');
  const service = createAuthService({
    sequelize: { transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) },
    models: {
      User: { create: async (values) => { saved = values; return { id: 'user-1', ...values }; }, findByPk: async () => ({ id: 'user-1', ...saved }) },
      AuthSession: { create: async (values) => ({ id: 'session-1', ...values }) },
      UserCredential: { create: async () => {}, findByPk: async () => ({ passwordChangedAt: now }) }, AuditLog: { create: async (record, options) => { audits.push({ record, options }); } },
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
  const acceptance = audits.find(item => item.record.action === 'account.terms_accepted');
  // Do not silently edit text a user already accepted. Publish a new version.
  assert.equal(documentSha256, '5901e597ed5d7356576c6c41a84690eac00b6197d64282ec479e7febf0f778cf');
  assert.deepEqual(acceptance.record.after, { version: TERMS_VERSION, documentSha256, acceptedAt: now.toISOString(), source: 'registration', explicitAcceptance: true });
  assert.equal(acceptance.record.actorUserId, 'user-1');
  assert.ok(acceptance.options.transaction);
  const { termsAccepted, termsVersion, ...noAgreement } = input;
  for (const invalid of [noAgreement, { ...input, termsAccepted: false }, { ...input, termsAccepted: 'true' }, { ...input, termsVersion: 'old-version' }]) {
    assert.equal(register.safeParse(invalid).success, false);
    await assert.rejects(() => service.register(invalid));
  }
  assert.equal(audits.filter(item => item.record.action === 'user.registered').length, 1, 'rejected assent cannot create another account');
});
