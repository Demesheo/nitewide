const test = require('node:test');
const assert = require('node:assert/strict');
const { request: httpRequest } = require('./support/http-client.cjs');
const { randomUUID, createHmac } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createAbuseService, POLICIES } = require('../src/services/abuse-service');
const { createPasswordRecord, signToken } = require('../src/services/auth-service');
test('shared PostgreSQL limits and session revocation across API instances', async () => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const sequelize = require('../src/db/sequelize').createSequelize(config);
  const models = require('../src/db/models').initModels(sequelize);
  const { createApp } = require('../src/app');
  const policies = { ...POLICIES, upload: { seconds: 3600, ip: 120, user: 2 }, report: { seconds: 60, ip: 300, user: 2 } };
  const servers = [];
  try {
    const user = await models.User.create({ email: `security-${randomUUID()}@example.test`, displayName: 'Security test' });
    const other = await models.User.create({ email: `other-${randomUUID()}@example.test`, displayName: 'Other user' });
    await models.UserCredential.create({ userId: user.id, ...await createPasswordRecord('SafePassword123') });
    for (let i = 0; i < 2; i++) {
      const abuse = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET, policies });
      const server = createApp({ sequelize, models, config: { ...config, NODE_ENV: 'production', trustProxy: false }, services: { abuse } }).listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve)); servers.push(server);
    }
    async function request(instance, path, { token, method = 'GET', body, headers = {} } = {}) {
      const response = await httpRequest(servers[instance], `/api${path}`, { method, token, headers, body });
      return { status: response.status, headers: response.headers, ...response.body };
    }
    const login = () => request(0, '/auth/sign-in', { method: 'POST', body: { email: user.email, password: 'SafePassword123' } });
    const first = (await login()).data.accessToken; const second = (await login()).data.accessToken;
    assert.equal((await request(1, '/auth/me', { token: first })).status, 200);
    const list = await request(0, '/auth/sessions', { token: first });
    assert.equal(list.data.length, 2); assert.equal(list.data.filter((s) => s.current).length, 1);
    const foreign = await models.AuthSession.create({ userId: other.id, expiresAt: new Date(Date.now() + 3600000) });
    await request(0, `/auth/sessions/${foreign.id}`, { token: first, method: 'DELETE' });
    assert.equal((await foreign.reload()).revokedAt, null);
    assert.equal((await request(0, '/auth/logout', { token: first, method: 'POST' })).status, 200);
    assert.equal((await request(1, '/auth/me', { token: first })).status, 401);
    assert.equal((await request(1, '/auth/me', { token: second })).status, 200);
    assert.equal((await request(1, '/auth/sessions/revoke-all', { token: second, method: 'POST' })).status, 200);
    assert.equal((await request(0, '/auth/me', { token: second })).status, 401);
    let token = (await login()).data.accessToken;
    await models.User.update({ lifecycleState: 'suspended' }, { where: { id: user.id } });
    await models.User.update({ lifecycleState: 'active' }, { where: { id: user.id } });
    assert.equal((await request(1, '/auth/me', { token })).status, 401, 'reactivation must not resurrect tokens');
    token = (await login()).data.accessToken;
    await models.UserCredential.update({ ...await createPasswordRecord('SafePassword123'), passwordChangedAt: new Date() }, { where: { userId: user.id } });
    assert.equal((await request(1, '/auth/me', { token })).status, 401);
    token = (await login()).data.accessToken;
    const legacy = signToken({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 100 }, config.AUTH_TOKEN_SECRET);
    assert.equal((await request(0, '/auth/me', { token: legacy })).status, 401);
    const sid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).sid;
    const otherSession = await models.AuthSession.create({ userId: other.id, expiresAt: new Date(Date.now() + 3600000) });
    const mismatched = signToken({ sub: user.id, sid: otherSession.id, exp: Math.floor(Date.now() / 1000) + 100 }, config.AUTH_TOKEN_SECRET);
    assert.equal((await request(0, '/auth/me', { token: mismatched })).status, 401);
    for (let i = 0; i < 2; i++) assert.equal((await request(i, '/business/uploads/image', { token, method: 'POST' })).status, 422);
    assert.equal((await request(1, '/business/uploads/image', { token, method: 'POST' })).status, 429);
    for (let i = 0; i < 2; i++) assert.equal((await request(i, '/admin/analytics', { token })).status, 403);
    assert.equal((await request(1, '/admin/analytics', { token })).status, 429);
    await models.AuthSession.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: sid } });
    assert.equal((await request(0, '/auth/me', { token })).status, 401);
    await models.AbuseBucket.destroy({ where: {} });
    const attempts = await Promise.all(Array.from({ length: 14 }, (_, i) => request(i % 2, '/auth/sign-in', { method: 'POST', body: { email: 'missing@example.test', password: 'WrongPassword123' }, headers: { 'X-Forwarded-For': `192.0.2.${i}` } })));
    assert.equal(attempts.filter((r) => r.status === 401).length, 10);
    assert.equal(attempts.filter((r) => r.status === 429).length, 4);
    assert.ok(attempts.find((r) => r.status === 429).headers['retry-after']);
    await models.AbuseBucket.update({ expiresAt: new Date(Date.now() - 1000) }, { where: {} });
    assert.equal((await request(1, '/auth/sign-in', { method: 'POST', body: { email: 'missing@example.test', password: 'WrongPassword123' } })).status, 401);
    // An account remains limited when an attacker rotates their IP and process.
    await models.AbuseBucket.destroy({ where: {} });
    for (let i = 0; i < 30; i++) {
      const abuse = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET });
      await abuse.before({ method: 'POST', path: '/auth/sign-in', ip: `192.0.2.${i}`, body: { email: i % 2 ? ' Target@example.test ' : 'target@example.test' } });
    }
    const rotated = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET });
    await assert.rejects(rotated.before({ method: 'POST', path: '/auth/sign-in', ip: '198.51.100.1', body: { email: 'target@example.test' } }), (error) => error.status === 429);
    await models.AbuseBucket.destroy({ where: {} });
    const shared = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET });
    for (let i = 0; i < 60; i++) await shared.before({ method: 'POST', path: '/auth/sign-in', ip: '192.0.2.1', body: { email: `different-${i}@example.test` } });
    await assert.rejects(shared.before({ method: 'POST', path: '/auth/sign-in', ip: '::ffff:192.0.2.1', body: { email: 'different-final@example.test' } }), (error) => error.status === 429);
    // Exercise the actual app middleware and shared counters, not just the
    // proxy predicate: short and stacked ingress must charge the same visitor.
    await models.AbuseBucket.destroy({ where: {} });
    for (let i = 0; i < 2; i++) {
      const abuse = createAbuseService({ sequelize, secret: config.AUTH_TOKEN_SECRET,
        policies: { ...POLICIES, session: { seconds: 60, ip: 2, user: 30 } } });
      const server = createApp({ sequelize, models, config: { ...config, TRUST_PROXY_MODE: 'cloudflare-render' }, services: { abuse } }).listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve)); servers.push(server);
    }
    const visitorRequests = [
      [2, '198.51.100.7', 401],
      [3, '192.0.2.9, 198.51.100.7, 172.70.10.2', 401],
      [2, '192.0.2.10, 198.51.100.7, 172.70.10.2, 162.158.1.2', 429],
      [3, '198.51.100.8, 172.70.10.2', 401],
    ];
    for (const [instance, forwarded, status] of visitorRequests) {
      assert.equal((await request(instance, '/auth/sessions', { headers: {
        'X-Forwarded-For': forwarded, 'CF-Connecting-IP': '192.0.2.99', 'True-Client-IP': '192.0.2.99',
      } })).status, status);
    }
    const counter = ip => models.AbuseBucket.findByPk(`session:ip:${createHmac('sha256', config.AUTH_TOKEN_SECRET).update(ip).digest('hex')}`);
    assert.equal((await counter('198.51.100.7')).count, 3);
    assert.equal((await counter('198.51.100.8')).count, 1);
    for (const spoof of ['192.0.2.9', '192.0.2.10', '192.0.2.99', '172.70.10.2']) assert.equal(await counter(spoof), null);
  } finally {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))); await sequelize.close();
  }
});
