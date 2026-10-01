const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { z } = require('zod');
const { createApp } = require('../src/app');
const { createMediaRouter } = require('../src/routes/media');
const { createBackgroundJobRouter } = require('../src/routes/background-jobs');
const { operations, supplementalPaths, externalAllowedMethods, externalRouteTemplate, metrics, health, emailJobQuery, notificationJobQuery, replayBody } = require('../src/http/app-contract');

function fixture() {
  return createApp({ sequelize: {}, models: {}, healthCheck: async () => {},
    config: { NODE_ENV: 'test', corsOrigins: [], AUTH_TOKEN_SECRET: 'development-test-secret-32-characters' },
    services: { email: { enabled: false }, permissions: { assertInternal: async () => {} },
      auth: { authenticate: async () => ({ id: 'account' }) }, abuse: { before: async () => {}, authenticated: async () => {} } } });
}
function registered(stack, prefix = '') {
  return stack.flatMap(layer => layer.route ? [layer.route.path].flat().flatMap(path => Object.keys(layer.route.methods).map(method => `${method} ${prefix}${path}`)) : []);
}
test('supplemental catalog covers actual app, media and background registrations exactly', () => {
  const app = fixture();
  const routes = [
    ...registered(app.router.stack),
    ...registered(createMediaRouter({ models: {}, requireUser() {}, config: {} }).stack, '/api'),
    ...registered(createBackgroundJobRouter({ sequelize: {}, models: {}, permissions: {}, email: {}, notificationJobs: {} }).stack, '/api/admin/background'),
  ].sort();
  assert.deepEqual(routes, operations.map(operation => `${operation.method} ${operation.path}`).sort());
});
test('supplemental OpenAPI covers binary uploads, private redirects, signed webhooks and health exceptions', () => {
  const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });
  const paths = supplementalPaths({ jsonSchema: schema => z.toJSONSchema(schema), errorSchema });
  assert.equal(paths['/business/uploads/image'].post.requestBody.content['multipart/form-data'].schema.properties.image['x-maxBytes'], 10485760);
  assert.equal(paths['/media/images/{assetId}'].get.responses[302].headers['Cache-Control'].schema.const, 'no-store');
  assert.equal(paths['/media/images/{assetId}'].get.responses[200].content['image/webp'].schema.format, 'binary');
  assert.equal(paths['/webhooks/resend'].post.parameters.length, 3);
  assert.equal(paths['/webhooks/resend'].post.responses[204].content, undefined);
  assert.deepEqual(paths['/health/ready'].get.servers, [{ url: '/' }]);
  assert.deepEqual(paths['/admin/diagnostics/metrics'].get.security, [{ bearerSession: [] }]);
  assert.equal(paths['/health/ready'].get.responses[503].content['application/json'].schema.properties.status.enum.includes('degraded'), true);
});
test('app-level wire responses and unsupported methods conform without leaking request data', async () => {
  const app = fixture();
  for (const path of ['/health', '/health/ready', '/health/live']) {
    const response = await request(app).get(path).expect(200);
    health.parse(response.body);
    await request(app).post(path).expect(405).expect('Allow', /GET/);
  }
  const response = await request(app).get('/api/admin/diagnostics/metrics').set('Authorization', 'Bearer private').expect(200);
  metrics.parse(response.body.data);
  await request(app).get('/api/webhooks/resend').expect(405).expect('Allow', /POST/);
  await request(app).post('/api/media/images/10000000-0000-4000-8000-000000000001').expect(405).expect('Allow', /GET/);
  assert.deepEqual(externalAllowedMethods('/api/admin/background/email/id/replay'), ['OPTIONS', 'POST']);
  assert.equal(externalRouteTemplate('/api/admin/background/email/private/replay', 'POST'), '/api/admin/background/email/:id/replay');
  assert.equal(externalRouteTemplate('/api/admin/background/private', 'GET'), undefined);
});
test('shared background request validators enforce pagination and replay bounds', () => {
  assert.deepEqual(emailJobQuery.parse({}), { page: 1, pageSize: 25, status: 'failed' });
  assert.deepEqual(notificationJobQuery.parse({ page: '2' }), { page: 2, pageSize: 25 });
  assert.throws(() => emailJobQuery.parse({ pageSize: 101 }));
  assert.throws(() => replayBody.parse({ reason: 'x' }));
  assert.throws(() => replayBody.parse({ reason: 'valid', private: 'not allowed' }));
});
