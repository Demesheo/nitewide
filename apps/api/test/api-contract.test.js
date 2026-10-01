const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { buildContract } = require('../src/http/contract-build');
const { routeInventory } = require('../src/http/route-inventory');
const { instrumentRouter } = require('../src/routes/contract-router');
const { jsonSchema, queries } = require('../src/http/api-contract');
const schemas = require('../src/http/schemas');
const business = require('../src/http/business-schemas');
const domain = require('../src/http/domain-query-schemas');

test('committed OpenAPI is deterministic and matches every registered operation', () => {
  const { document, contracts, router } = buildContract();
  const artifact = fs.readFileSync(path.resolve(__dirname, '../../../docs/api/openapi.json'), 'utf8');
  assert.equal(artifact, `${JSON.stringify(document, null, 2)}\n`, 'Run npm run api:contract after reviewing contract changes');
  const actual = router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method} ${layer.route.path}`)).sort();
  assert.deepEqual(contracts.map((route) => `${route.method} ${route.path}`).sort(), actual);
  assert.deepEqual(routeInventory.map((route) => `${route.method} ${route.path}`).sort(), actual);
  const operationIds = contracts.map((route) => document.paths[route.path.replace(/:([A-Za-z]+)/g, '{$1}')][route.method].operationId);
  assert.equal(new Set(operationIds).size, operationIds.length);
  assert.equal(document.openapi, '3.1.0');
});

test('request and query contracts retain the actual shared validators and canonical dates', () => {
  const { contracts } = buildContract();
  const find = (method, path) => contracts.find((route) => route.method === method && route.path === path);
  assert.equal(find('post', '/auth/register').requestSchema, schemas.register);
  assert.equal(find('post', '/orders').requestSchema, schemas.checkout);
  assert.equal(find('post', '/business/events').requestSchema, business.eventEditor);
  assert.equal(find('get', '/business/reports/:table').querySchema, business.reportDetailQuery);
  assert.equal(find('get', '/customer/bookings').querySchema, domain.bookings);
  assert.equal(find('post', '/admin/onboarding').requestSchema, require('../src/services/admin-onboarding-service').onboardingSchema);
  assert.equal(find('post', '/admin/management/users/:id/scoped-role').requestSchema, require('../src/services/admin-role-service').scopedRoleSchema);
  assert.equal(find('patch', '/admin/management/:resource/:id').resourceSchemas.users, require('../src/services/admin-edit-service').schemas.users);
  assert.equal(queries['/business/events'], business.eventListQuery);
  const eventBody = jsonSchema(schemas.event, 'input');
  assert.equal(eventBody.properties.startsAt.type, 'string');
  assert.equal(eventBody.properties.startsAt.format, 'date-time');
  assert.equal(eventBody.properties.guestlistCapacity.type, 'integer');
});

test('registration rejects undocumented operations and method lookup preserves legacy POST events', () => {
  const { router } = buildContract();
  assert.deepEqual(router.allowedMethods('/events'), ['GET', 'HEAD', 'OPTIONS', 'POST']);
  assert.deepEqual(router.allowedMethods('/business/events/not-a-real-id/detail'), ['GET', 'HEAD', 'OPTIONS']);
  assert.deepEqual(router.allowedMethods('/nothing-here'), []);
  assert.throws(() => instrumentRouter(express.Router()).get('/undocumented', () => {}), /API contract missing/);
});

test('mixed CSV and asynchronous export statuses and schema references are executable', () => {
  const { document } = buildContract();
  const operation = document.paths['/business/reports/export.csv'].get;
  assert.ok(operation.responses[200].content['text/csv']);
  assert.ok(operation.responses[202].content['application/json']);
  assert.ok(document.paths['/orders'].post.responses[200]);
  assert.ok(document.paths['/orders'].post.responses[201]);
  const scan = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'), 'No external schema dependencies');
      let resolved = document;
      for (const key of value.$ref.slice(2).split('/')) resolved = resolved?.[key.replace(/~1/g, '/').replace(/~0/g, '~')];
      assert.ok(resolved, `Broken schema reference ${value.$ref}`);
    }
    for (const child of Object.values(value)) scan(child);
  };
  scan(document);
  assert.equal(document.paths['/customer/saved/ids'].get.parameters.find((parameter) => parameter.name === 'eventIds').schema.type, 'string');
  assert.equal(document.paths['/business/analytics'].get.deprecated, true);
  assert.equal(document.paths['/business/analytics'].get.responses[200], undefined);
  assert.ok(document.paths['/admin/management/{resource}'].post.requestBody);
  const contract = buildContract().contracts.find((value) => value.path === '/business/admissions/events');
  assert.equal(contract.responseSchemas[200].safeParse({ data: { items: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Projected event', startsAt: '2026-10-01T01:00:00Z', endsAt: '2026-10-01T04:00:00Z' }], page: 1, pageSize: 20, total: 1, hasMore: false, serverTime: '2026-10-01T00:00:00Z', nextEvent: null } }).success, true);
});
