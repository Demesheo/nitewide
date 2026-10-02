const test = require('node:test');
const assert = require('node:assert/strict');
const { createAbuseService, routePolicy, clientNetwork, POLICIES } = require('../src/services/abuse-service');
test('IPv6 privacy addresses share a /64; IPv4 mapped addresses normalize', () => {
  assert.equal(clientNetwork('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(clientNetwork('2001:db8::1'), clientNetwork('2001:0db8:0:0::abcd'));
  assert.notEqual(clientNetwork('2001:db8::1'), clientNetwork('2001:db8:1::1'));
});
test('sensitive endpoint classification covers uploads, exports, invitations and authentication', () => {
  for (const [method, path, group] of [
    ['POST', '/auth/sign-in', 'login'], ['POST', '/auth/register', 'registration'],
    ['POST', '/auth/business/sign-in', 'login'], ['POST', '/business/access-requests', 'access_request'],
    ['POST', '/auth/password/change', 'password_change'],
    ['POST', '/business/events/abc/guestlist-invitations', 'invitation'],
    ['POST', '/business/organizations/abc/invitations/123/resend', 'invitation'],
    ['POST', '/guestlist-invitations/token/claim', 'guestlist_link'],
    ['GET', '/guestlist-invitations/token/pass', 'guestlist_link'],
    ['POST', '/admin/onboarding', 'invitation'], ['POST', '/auth/onboarding/accept', 'recovery'],
    ['POST', '/business/uploads/image', 'upload'], ['GET', '/business/reports/export.csv', 'export'],
    ['GET', '/business/reports/events', 'report'], ['GET', '/admin/analytics', 'report'],
    ['GET', '/auth/sessions', 'session'], ['GET', '/media/images/123', null],
    ['POST', '/AUTH/SIGN-IN/', 'login'], ['HEAD', '/business/reports/export.csv', 'export'],
    ['POST', '/admin/management/team_invitations', 'invitation'],
    ['POST', '/admin/management/guestlist_invitations', 'invitation'],
  ]) assert.equal(routePolicy(method, path), group, path);
});
test('normalized accounts and IPs are independently charged without storing personal identifiers', async () => {
  const queries = [];
  const abuse = createAbuseService({ secret: 'test-secret', sequelize: { query: async (_sql, { replacements }) => { queries.push(replacements); return [[{ count: 1, retry: 900 }]]; } } });
  await abuse.before({ method: 'POST', path: '/auth/sign-in', ip: '192.0.2.1', body: { email: ' Guest@Example.com ' } });
  await abuse.before({ method: 'POST', path: '/auth/sign-in', ip: '192.0.2.2', body: { email: 'guest@example.com' } });
  assert.equal(queries[1].key, queries[4].key);
  assert.notEqual(queries[0].key, queries[3].key);
  assert.equal(JSON.stringify(queries).includes('example.com'), false);
  assert.equal(queries[2].limit, POLICIES.login.pair);
});
test('blocked limits give retry information; database failure never bypasses protection', async () => {
  const request = { method: 'POST', path: '/auth/sign-in', ip: '192.0.2.1' };
  const blocked = createAbuseService({ secret: 'test', sequelize: { query: async () => [[{ count: 61, retry: 120 }]] } });
  await assert.rejects(blocked.before(request), (error) => error.status === 429 && error.details.retryAfterSeconds === 120);
  const failed = createAbuseService({ secret: 'test', sequelize: { query: async () => { throw new Error('offline'); } } });
  await assert.rejects(failed.before(request), (error) => error.status === 503 && error.code === 'SECURITY_UNAVAILABLE');
});
test('authenticated quotas are per user, not token, and charged once per request', async () => {
  let calls = 0;
  const abuse = createAbuseService({ secret: 'test', sequelize: { query: async () => { calls++; return [[{ count: 1, retry: 60 }]]; } } });
  const req = { userId: 'user', abuseGroup: 'report' };
  await abuse.authenticated(req); await abuse.authenticated(req);
  assert.equal(calls, 1);
});
test('cleanup is bounded and rechecks expiry so concurrently renewed rows are not removed', async () => {
  let time = 0; const queries = [];
  const abuse = createAbuseService({ secret: 'test', clock: () => time, sequelize: { query: async (sql) => { queries.push(sql); return [[{ count: 1, retry: 60 }]]; } } });
  const req = { method: 'POST', path: '/auth/sign-in', ip: '192.0.2.1' };
  await abuse.before(req);
  assert.equal(queries.length, 1);
  time = 60001;
  await abuse.before(req);
  const cleanup = queries.filter((sql) => sql.startsWith('DELETE'));
  assert.equal(cleanup.length, 2);
  for (const sql of cleanup) {
    assert.match(sql, /WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day' AND/);
    assert.match(sql, /LIMIT 1000/);
  }
  await abuse.before(req);
  assert.equal(queries.filter((sql) => sql.startsWith('DELETE')).length, 2);
});
