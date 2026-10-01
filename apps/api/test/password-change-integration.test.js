const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { request } = require('./support/http-client.cjs');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createPasswordRecord, passwordMatches } = require('../src/services/auth-service');
const { createAbuseService, POLICIES } = require('../src/services/abuse-service');
const { responses } = require('../src/http/api-contract');

test('authenticated password changes validate, rotate sessions, invalidate reset links and audit atomically', async () => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  const models = require('../src/db/models').initModels(sequelize);
  try {
    const user = await models.User.create({ email: `password-${randomUUID()}@example.test`, displayName: 'Password test' });
    const oldPassword = 'OldPassword123', newPassword = 'NewPassword456';
    await models.UserCredential.create({ userId: user.id, ...await createPasswordRecord(oldPassword) });
    const abuse = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET, policies: { ...POLICIES, password_change: { seconds: 3600, ip: 100, user: 100 } } });
    const app = require('../src/app').createApp({ sequelize, models, config, services: { abuse } });
    const login = (password = oldPassword) => request(app, '/api/auth/sign-in', { method: 'POST', body: { email: user.email, password } });
    const first = (await login()).body.data.accessToken, second = (await login()).body.data.accessToken;
    const change = (body, token = first) => request(app, '/api/auth/password/change', { method: 'POST', token, body });
    const valid = { currentPassword: oldPassword, password: newPassword, confirmPassword: newPassword };
    assert.equal((await request(app, '/api/auth/password/change', { method: 'POST', body: valid })).status, 401);
    assert.equal((await change({ ...valid, currentPassword: 'WrongPassword123' })).status, 400);
    assert.equal((await change({ ...valid, password: 'short', confirmPassword: 'short' })).status, 422);
    assert.equal((await change({ ...valid, confirmPassword: `${newPassword} ` })).status, 422, 'confirmation is exact, not trimmed');
    assert.equal((await change({ ...valid, password: oldPassword, confirmPassword: oldPassword })).status, 422);
    assert.equal((await request(app, '/api/auth/me', { token: first })).status, 200, 'invalid attempts must not revoke sessions');
    assert.equal(await passwordMatches(oldPassword, await models.UserCredential.findByPk(user.id)), true);
    const reset = await models.UserActionToken.create({ userId: user.id, email: user.email, purpose: 'password_reset', tokenHash: createHash('sha256').update('unused-test-reset-token').digest('hex'), expiresAt: new Date(Date.now() + 3600000) });
    const verification = await models.UserActionToken.create({ userId: user.id, email: user.email, purpose: 'verify_email', tokenHash: createHash('sha256').update('unused-verification-token').digest('hex'), expiresAt: new Date(Date.now() + 3600000) });
    const changed = await change(valid);
    assert.equal(changed.status, 200);
    assert.equal(responses.session.safeParse(changed.body.data).success, true);
    const fresh = changed.body.data.accessToken;
    assert.notEqual(fresh, first);
    for (const token of [first, second]) assert.equal((await request(app, '/api/auth/me', { token })).status, 401);
    assert.equal((await request(app, '/api/auth/me', { token: fresh })).status, 200);
    assert.equal((await login()).status, 401);
    assert.equal((await login(newPassword)).status, 200);
    assert.ok((await reset.reload()).consumedAt);
    assert.equal((await verification.reload()).consumedAt, null, 'password change must not invalidate email verification');
    assert.equal((await request(app, '/api/auth/password-reset/complete', { method: 'POST', body: { token: 'unused-test-reset-token', password: oldPassword } })).status, 400);
    const audit = await models.AuditLog.findAll({ where: { actorUserId: user.id, action: 'account.password_changed' } });
    assert.equal(audit.length, 1);
    const serialized = JSON.stringify(audit);
    for (const secret of [oldPassword, newPassword, 'passwordHash', 'passwordSalt']) assert.equal(serialized.includes(secret), false);

    // Concurrent requests authorized with the same old session cannot both write.
    const next = { currentPassword: newPassword, password: 'NextPassword789', confirmPassword: 'NextPassword789' };
    const results = await Promise.all([change(next, fresh), change(next, fresh)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
    assert.equal((await models.AuditLog.count({ where: { actorUserId: user.id, action: 'account.password_changed' } })), 2);
  } finally { await sequelize.close(); }
});

test('password-change account limits remain shared across tokens and instances', async () => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  try {
    const services = [0, 1].map(() => createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET }));
    const userId = randomUUID();
    for (let index = 0; index < 5; index++) await services[index % 2].authenticated({ userId, abuseGroup: 'password_change' });
    await assert.rejects(services[1].authenticated({ userId, abuseGroup: 'password_change' }), (error) => error.status === 429);
  } finally { await sequelize.close(); }
});
