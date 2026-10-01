const test = require('node:test');
const assert = require('node:assert/strict');
const schemas = require('../src/http/business-access-schemas');
const { assertBusinessAccess } = require('../src/services/business-access-policy');
const { buildContract } = require('../src/http/contract-build');

const request = { displayName: 'Business Contact', email: ' OWNER@Example.com ', phone: '(407) 555-0123',
  businessName: 'Downtown Events', role: 'owner', details: 'I operate this business and need access.' };
const approval = { kind: 'organization', recipient: { email: 'OWNER@Example.com', displayName: 'Business Contact' },
  organization: { name: 'Downtown Events' }, confirmedAuthority: true, reason: 'Confirmed business authority', version: 0 };

test('public access requests accept contact details, normalize email and phone, and reject credential or grant fields', () => {
  const value = schemas.requestAccess.parse(request);
  assert.equal(value.email, 'owner@example.com'); assert.equal(value.phone, '+14075550123');
  for (const extra of [{ password: 'Unrequested12345' }, { isInternalAdmin: true }, { independentCreator: true }, { organizationId: 'id' }]) {
    assert.equal(schemas.requestAccess.safeParse({ ...request, ...extra }).success, false);
  }
  for (const change of [{ phone: '' }, { phone: '123' }, { role: 'employee' }, { details: 'Short' }, { businessName: 'x'.repeat(161) }]) {
    assert.equal(schemas.requestAccess.safeParse({ ...request, ...change }).success, false);
  }
});

test('manual review requires current version, confirmed authority and full business onboarding', () => {
  const value = schemas.approve.parse(approval);
  assert.equal(value.recipient.email, 'owner@example.com');
  assert.equal(value.recipient.role, 'owner'); assert.deepEqual(value.venues, []);
  for (const change of [{ kind: 'user', organization: undefined }, { kind: 'independent_creator' }, { confirmedAuthority: false },
    { version: undefined }, { version: -1 }, { isInternalAdmin: true }]) {
    assert.equal(schemas.approve.safeParse({ ...approval, ...change }).success, false);
  }
  assert.equal(schemas.decline.safeParse({ version: 0, reason: 'Cannot confirm authority' }).success, true);
  assert.equal(schemas.decline.safeParse({ version: 0, reason: '' }).success, false);
  assert.deepEqual(schemas.query.parse({ statuses: 'pending', page: '2', pageSize: '5' }).statuses, ['pending']);
  assert.equal(schemas.query.safeParse({ pageSize: 101 }).success, false);
  assert.equal(schemas.query.safeParse({ statuses: ['pending', 'unknown'] }).success, false);
});

test('legacy explicit creators and internal staff qualify only while their account is completed and active', async () => {
  const models = { User: { findByPk: async () => { throw new Error('A supplied actor should be reused'); } } };
  for (const grant of [{ independentCreator: true }, { isInternalAdmin: true }]) {
    const actor = { id: 'user', isActive: true, lifecycleState: 'active', ...grant };
    assert.equal(await assertBusinessAccess(models, actor.id, null, actor), actor);
    for (const state of [{ onboardingPending: true }, { isActive: false }, { lifecycleState: 'suspended' }, { lifecycleState: 'archived' }]) {
      await assert.rejects(assertBusinessAccess(models, actor.id, null, { ...actor, ...state }), { code: 'BUSINESS_ACCESS_REQUIRED', status: 403 });
    }
  }
});

test('access request operations publish executable body, query, auth and response contracts', () => {
  const { contracts, document } = buildContract();
  const find = (method, path) => contracts.find(operation => operation.method === method && operation.path === path);
  assert.equal(find('post', '/business/access-requests').authenticated, false);
  assert.equal(find('post', '/business/access-requests').requestSchema, schemas.requestAccess);
  assert.equal(find('get', '/admin/business-access/requests').querySchema, schemas.query);
  assert.equal(find('post', '/admin/business-access/requests/:id/approve').requestSchema, schemas.approve);
  assert.equal(find('post', '/admin/business-access/requests/:id/decline').authenticated, true);
  const signIn = document.paths['/auth/business/sign-in'].post;
  assert.ok(signIn.responses[200].content['application/json'].schema.properties.data.properties.accessToken);
  const pending = document.paths['/business/access-requests'].post;
  assert.deepEqual(pending.security, []); assert.ok(pending.responses[202]);
  const list = document.paths['/admin/business-access/requests'].get;
  assert.ok(list.parameters.some(parameter => parameter.name === 'statuses'));
  assert.ok(list.responses[200].content['application/json'].schema.properties.data.properties.items.items.properties.version);
  assert.ok(document.paths['/admin/overview/needs-attention'].get.parameters.find(parameter => parameter.name === 'kind').schema.enum.includes('business_access_request'));
});
