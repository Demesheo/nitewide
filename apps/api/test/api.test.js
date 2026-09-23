const test = require('node:test'); const assert = require('node:assert/strict'); const { createApp } = require('../src/app');
const { Op } = require('sequelize');
async function request(app, path, options = {}) { const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve)); try { const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options); return { status: response.status, body: await response.json() }; } finally { await new Promise((resolve) => server.close(resolve)); } }
function setup(onGuestlistQuery, guestlistScope = { canReviewAny: true, eventAffiliateIds: [] }, onPublicEventQuery) {
  const event = { id: 'e1', organizationId: 'org-1', status: 'published', location: null, guestlistCapacity: 50, update: async (changes) => Object.assign(event, changes), toJSON: () => ({ id: event.id, title: 'Afterglow', status: event.status, guestlistCapacity: event.guestlistCapacity }) };
  const affiliate = { id: 'a1', eventId: event.id, code: 'PROMOTER', status: 'active', guestlistAllocation: 20, user: { id: 'p1', displayName: 'Promoter One' }, orgAffiliate: null, update: async (changes) => Object.assign(affiliate, changes) };
  const sequelize = { transaction: async (work) => work({ LOCK: { UPDATE: 'UPDATE' } }) };
  const models = {
    Event: { sequelize, findAll: async (query) => { onPublicEventQuery?.(query); return [event]; }, findByPk: async () => event }, Location: {}, Organization: {}, Offering: {},
    Order: { findOne: async () => null }, OrderItem: {}, Ticket: {}, User: {}, OrganizationOwner: {}, OrgAffiliate: {}, EventAffiliate: { findOne: async () => affiliate, findAll: async () => [affiliate] }, GuestlistEntry: { sum: async (_field, { where }) => where.eventAffiliateId ? 3 : 5, findAll: async ({ where, include }) => { onGuestlistQuery?.(where, include); return []; }, findOne: async ({ where }) => where.id === 'owned-entry' ? { id: 'owned-entry' } : null }, CheckIn: {}, AuditLog: { create: async () => ({}) },
  };
  const authSession = { accessToken: 'test-token', user: { id: 'user-1', email: 'customer@example.com', displayName: 'Test Customer' }, roles: ['customer'] };
  const services = { auth: { register: async () => authSession, signIn: async () => authSession, authenticate: async () => ({ id: 'user-1' }), me: async () => ({ user: authSession.user, roles: authSession.roles }) }, permissions: { assertManageEvent: async () => event, guestlistReviewScope: async () => guestlistScope, assertInternal: async () => ({}) }, checkout: async (input) => ({ order: { id: 'o1', buyerUserId: input.buyerUserId }, credentials: [], replayed: false }), requestGuestlist: async () => ({ entry: { status: 'pending' }, requiresApproval: true }), reviewGuestlist: async (input) => ({ entry: { status: input.decision === 'cancel' ? 'rejected' : 'confirmed' }, qrToken: input.decision === 'cancel' ? null : 'approved-token' }), checkIn: async () => ({}) };
  return createApp({ sequelize: {}, models, services, config: { NODE_ENV: 'test', corsOrigins: [], AUTH_TOKEN_SECRET: 'test-secret-at-least-32-characters' }, healthCheck: async () => {} });
}
test('health endpoint reports the API is ready', async () => { const response = await request(setup(), '/health'); assert.equal(response.status, 200); assert.equal(response.body.service, 'nitewide-api'); });
test('public discovery returns published events', async () => { const response = await request(setup(), '/api/events'); assert.equal(response.status, 200); assert.equal(response.body.data[0].title, 'Afterglow'); });
test('public discovery filters finished events before applying its limit', async () => {
  let query;
  const response = await request(setup(undefined, undefined, (value) => { query = value; }), '/api/events?limit=100');
  assert.equal(response.status, 200);
  assert.equal(query.where.status, 'published');
  assert.equal(query.where.isDiscoverable, true);
  assert.ok(query.where.endsAt[Op.gte] instanceof Date);
  assert.deepEqual(query.order, [['startsAt', 'ASC']]);
  assert.equal(query.limit, 100);
});
test('anyone can register a customer identity', async () => { const response = await request(setup(), '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Test Customer', email: 'customer@example.com', password: 'Customer123' }) }); assert.equal(response.status, 201); assert.deepEqual(response.body.data.roles, ['customer']); assert.equal(response.body.data.accessToken, 'test-token'); });
test('a customer can sign in and receive a session', async () => { const response = await request(setup(), '/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'customer@example.com', password: 'Customer123' }) }); assert.equal(response.status, 200); assert.equal(response.body.data.user.email, 'customer@example.com'); });
test('a bearer session resolves the signed-in user', async () => { const response = await request(setup(), '/api/auth/me', { headers: { authorization: 'Bearer test-token' } }); assert.equal(response.status, 200); assert.deepEqual(response.body.data.roles, ['customer']); });
test('checkout requires a user identity', async () => { const response = await request(setup(), '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 401); assert.equal(response.body.error.code, 'UNAUTHENTICATED'); });
test('checkout validates request data before invoking the service', async () => { const response = await request(setup(), '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000004' }, body: '{}' }); assert.equal(response.status, 422); assert.equal(response.body.error.code, 'VALIDATION_ERROR'); });
test('checkout API returns newly issued credentials', async () => { const response = await request(setup(), '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000004' }, body: JSON.stringify({ eventId: '40000000-0000-4000-8000-000000000001', idempotencyKey: 'api-test-key', items: [{ offeringId: '50000000-0000-4000-8000-000000000001', quantity: 1 }] }) }); assert.equal(response.status, 201); assert.equal(response.body.data.order.buyerUserId, '10000000-0000-4000-8000-000000000004'); });
test('guestlist submission returns a pending request without a credential', async () => { const response = await request(setup(), '/api/events/40000000-0000-4000-8000-000000000001/guestlist', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000004' }, body: JSON.stringify({ partySize: 2 }) }); assert.equal(response.status, 202); assert.equal(response.body.data.entry.status, 'pending'); assert.equal(response.body.data.requiresApproval, true); assert.equal(response.body.data.qrToken, undefined); });
test('guestlist status filter accepts multiple selections and all', async () => {
  const queries = [];
  const app = setup((where, include) => queries.push({ where, include }));
  const options = { headers: { 'x-user-id': '10000000-0000-4000-8000-000000000005' } };
  const route = '/api/business/events/40000000-0000-4000-8000-000000000001/guestlist';
  assert.equal((await request(app, `${route}?status=pending&status=confirmed`, options)).status, 200);
  assert.deepEqual(queries[0].where.status[Op.in], ['pending', 'confirmed']);
  assert.equal(queries[0].include[1].include[0].as, 'user');
  assert.ok(queries[0].include[1].include[0].attributes.includes('displayName'));
  assert.equal((await request(app, `${route}?status=all`, options)).status, 200);
  assert.equal(Object.hasOwn(queries[1].where, 'status'), false);
  assert.equal((await request(app, `${route}?status=unknown`, options)).status, 422);
  assert.equal((await request(app, `${route}?status=cancelled`, options)).status, 422);
});
test('authorized staff can revoke an approved guestlist through the decision route', async () => {
  const response = await request(setup(), '/api/business/events/40000000-0000-4000-8000-000000000001/guestlist/90000000-0000-4000-8000-000000000001/decision', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000005' }, body: JSON.stringify({ decision: 'cancel' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.entry.status, 'rejected');
  assert.equal(response.body.data.qrToken, null);
});
test('a non-manager referrer sees only their own entries and cannot review direct or another person’s entry', async () => {
  const queries = [];
  const app = setup((where) => queries.push(where), { canReviewAny: false, eventAffiliateIds: ['affiliate-1'] });
  const headers = { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000003' };
  const base = '/api/business/events/40000000-0000-4000-8000-000000000001/guestlist';
  assert.equal((await request(app, `${base}?status=all`, { headers })).status, 200);
  assert.deepEqual(queries[0].eventAffiliateId[Op.in], ['affiliate-1']);
  for (const decision of ['approve', 'reject', 'cancel']) {
    const denied = await request(app, `${base}/direct-entry/decision`, { method: 'POST', headers, body: JSON.stringify({ decision }) });
    assert.equal(denied.status, 403);
  }
  const own = await request(app, `${base}/owned-entry/decision`, { method: 'POST', headers, body: JSON.stringify({ decision: 'approve' }) });
  assert.equal(own.status, 200);
});
test('an event manager can set the direct venue guestlist capacity', async () => { const response = await request(setup(), '/api/business/events/40000000-0000-4000-8000-000000000001/guestlist-capacity', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000005' }, body: JSON.stringify({ guestlistCapacity: 50 }) }); assert.equal(response.status, 200); assert.equal(response.body.data.guestlistCapacity, 50); });
test('an event manager can set a promoter guestlist allocation', async () => { const response = await request(setup(), '/api/business/events/40000000-0000-4000-8000-000000000001/affiliates/30000000-0000-4000-8000-000000000001/guestlist-allocation', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': '10000000-0000-4000-8000-000000000005' }, body: JSON.stringify({ guestlistAllocation: 20 }) }); assert.equal(response.status, 200); assert.equal(response.body.data.guestlistAllocation, 20); });
test('an event manager can view separate venue and promoter guestlist pools', async () => { const response = await request(setup(), '/api/business/events/40000000-0000-4000-8000-000000000001/guestlist-settings', { headers: { 'x-user-id': '10000000-0000-4000-8000-000000000005' } }); assert.equal(response.status, 200); assert.deepEqual(response.body.data.direct, { capacity: 50, used: 5 }); assert.equal(response.body.data.promoters[0].effectiveGuestlistAllocation, 20); assert.equal(response.body.data.promoters[0].used, 3); });
