const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordRecord, passwordMatches, signToken, verifyToken } = require('../src/services/auth-service');

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
