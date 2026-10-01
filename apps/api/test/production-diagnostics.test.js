const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const { errorHandler, publicError, validate } = require('../src/http/middleware');
const { DomainError } = require('../src/domain/errors');
const { createDiagnostics, instrumentDatabase } = require('../src/diagnostics/observability');
const { createHealth } = require('../src/diagnostics/health');
const { createShutdown } = require('../src/diagnostics/shutdown');
const { createApp } = require('../src/app');
const { createSequelize } = require('../src/db/sequelize');
const { getConfig } = require('../src/config');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

function fixture({ check = async () => {}, permissions, diagnostics, models = {} } = {}) {
  return createApp({ sequelize: {}, models, healthCheck: check,
    config: { NODE_ENV: 'test', corsOrigins: [], AUTH_TOKEN_SECRET: 'development-test-secret-32-characters', READINESS_TIMEOUT_MS: 20 },
    services: { diagnostics, email: { enabled: false }, permissions: permissions || { assertInternal: async () => {} },
      auth: { authenticate: async () => ({ id: 'account' }) }, abuse: { before: async () => {}, authenticated: async () => {} } } });
}
function errors() {
  const logs = [], diagnostics = createDiagnostics({ write: value => logs.push(JSON.parse(value)) });
  const app = express(); app.use(diagnostics.middleware); app.use(express.json({ limit: '1kb' }));
  app.post('/json', (_req, res) => res.json({ data: 'ok' }));
  app.post('/validation', validate(z.object({ email: z.email(), password: z.string().min(10) })), (_req, res) => res.end());
  app.get('/legacy', (_req, _res, next) => next(Object.assign(new Error('postgres://secret/report-query'), { status: 400 })));
  app.get('/unexpected', (_req, _res, next) => next(Object.assign(new Error('password=secret'), { sql: 'select private', bind: ['secret'] })));
  app.get('/domain', (_req, _res, next) => next(new DomainError('Guestlist is full', { status: 409, code: 'GUESTLIST_FULL' })));
  app.use(errorHandler); return { app, diagnostics, logs };
}

test('errors preserve intentional HTTP status and expose safe messages with request IDs', async () => {
  const { app, logs } = errors();
  const legacy = await request(app).get('/legacy').expect(400);
  assert.equal(legacy.body.error.code, 'BAD_REQUEST');
  assert.equal(legacy.body.error.requestId, legacy.headers['x-request-id']);
  const unexpected = await request(app).get('/unexpected').expect(500);
  assert.equal(unexpected.body.error.message, 'Unexpected server error');
  assert.equal((await request(app).get('/domain').expect(409)).body.error.message, 'Guestlist is full');
  assert.doesNotMatch(JSON.stringify([legacy.body, unexpected.body, logs]), /secret|private|postgres:|password=/);
  assert.ok(logs.some(log => log.event === 'http_request' && log.status === 500 && log.level === 'error'));
  assert.ok(logs.some(log => log.failureCategory === 'internal'));
});

test('interrupted response streams forward only a sanitized error to Express', () => {
  const req = {}, raw = Object.assign(new Error('token=private-secret SQL select email'), {
    sql: 'select private-secret', original: { message: 'postgres://private-secret' }, headers: { Authorization: 'private-secret' },
  });
  let forwarded;
  errorHandler(raw, req, { headersSent: true }, error => { forwarded = error; });
  assert.notEqual(forwarded, raw); assert.equal(forwarded.status, 500); assert.equal(forwarded.code, 'INTERNAL_ERROR');
  assert.equal(req.diagnosticError, 'internal');
  assert.doesNotMatch(forwarded.stack + JSON.stringify(forwarded), /private-secret|select email|postgres:|Authorization/);
  assert.equal(forwarded.cause, undefined);
});

test('malformed JSON, oversized JSON and raw webhook bodies have explicit safe errors', async () => {
  const { app } = errors();
  const invalid = await request(app).post('/json').set('Content-Type', 'application/json').send('{"password":"secret"').expect(400);
  assert.equal(invalid.body.error.code, 'MALFORMED_JSON'); assert.doesNotMatch(JSON.stringify(invalid.body), /secret/);
  const large = await request(app).post('/json').send({ value: 'x'.repeat(2000) }).expect(413);
  assert.equal(large.body.error.code, 'REQUEST_TOO_LARGE');
  const webhook = await request(fixture()).post('/api/webhooks/resend').set('Content-Type', 'application/json').send(JSON.stringify({ value: 'x'.repeat(270000) })).expect(413);
  assert.equal(webhook.body.error.code, 'REQUEST_TOO_LARGE');
  const upload = await request(fixture({ models: { User: { findByPk: async () => ({ isActive: true }) } } }))
    .post('/api/business/uploads/image').set('Authorization', 'Bearer private').attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.png').expect(413);
  assert.equal(upload.body.error.code, 'REQUEST_TOO_LARGE');
});

test('validation provides safe field locations without custom errors or values', async () => {
  const { app } = errors();
  const response = await request(app).post('/validation').send({ email: 'private-invalid-email', password: 'secret' }).expect(422);
  assert.deepEqual(response.body.error.details.fieldErrors, { email: ['Invalid value'], password: ['Invalid value'] });
  assert.doesNotMatch(JSON.stringify(response.body.error), /private-invalid|secret/);
  assert.equal(publicError(Object.assign(new Error('sql private'), { statusCode: 405 })).status, 405);
  assert.equal(publicError(Object.assign(new Error('sql private'), { status: 410 })).status, 410);
  assert.equal(publicError({ original: { code: '57014' } }).code, 'DATABASE_TIMEOUT');
  assert.equal(publicError({ name: 'SequelizeValidationError', message: 'private' }).status, 422);
  assert.equal(publicError({ original: { code: '23503', detail: 'private' } }).code, 'REFERENCE_CONFLICT');
  assert.equal(publicError({ original: { code: '23514', constraint: 'event_media_ready' } }).code, 'MEDIA_NOT_READY');
});

test('request IDs accept UUID correlation only and metrics have bounded cardinality', async () => {
  const logs = [], diagnostics = createDiagnostics({ write: value => logs.push(JSON.parse(value)), maxRoutes: 2 });
  const app = express(); app.use(diagnostics.middleware);
  app.get('/resource/:id', (req, res) => res.json({ id: req.params.id }));
  app.use((_req, res) => res.sendStatus(404));
  const id = '10000000-0000-4000-8000-000000000001';
  await request(app).get('/resource/private-email?token=secret').set('authorization', 'Bearer secret').set('x-request-id', id).expect('X-Request-Id', id);
  const invalid = await request(app).get('/resource/another-email').set('x-request-id', 'private-token').expect(200);
  assert.notEqual(invalid.headers['x-request-id'], 'private-token');
  for (let index = 0; index < 8; index++) await request(app).get(`/unknown-private-${index}`).expect(404);
  assert.ok(diagnostics.snapshot().requests.length <= 3);
  assert.doesNotMatch(JSON.stringify([logs, diagnostics.snapshot()]), /private-email|another-email|private-token|secret|unknown-private/);
  assert.equal(diagnostics.snapshot().requests[0].count, 2);
  diagnostics.log('http_request', { error: new Error('private'), sql: 'private', requestId: 'private', route: 'https://secret?token=x' });
  assert.doesNotMatch(JSON.stringify(logs), /private|secret/);
});

test('query metrics record failures, timeouts and per-request counts without SQL or bindings', async () => {
  const logs = [], diagnostics = createDiagnostics({ write: line => logs.push(JSON.parse(line)) });
  const db = instrumentDatabase({ query: async (_sql, options) => { if (options.fail) throw { original: { code: options.fail }, sql: 'secret' }; return []; } }, diagnostics);
  const app = express(); app.use(diagnostics.middleware);
  app.get('/query', async (_req, res) => {
    await db.query('select secret', { type: 'SELECT', replacements: { email: 'secret' } });
    await assert.rejects(db.query('select secret', { type: 'SELECT', fail: '57014' }));
    await assert.rejects(db.query('select secret', { type: 'UNTRUSTED', fail: '42P01' }));
    res.end();
  });
  await request(app).get('/query').expect(200);
  assert.equal(logs[0].queryCount, 3);
  assert.deepEqual(diagnostics.snapshot().queries.map(value => value.key).sort(), ['OTHER error', 'SELECT ok', 'SELECT timeout']);
  assert.doesNotMatch(JSON.stringify([logs, diagnostics.snapshot()]), /secret|email|42P01|UNTRUSTED/);
});

test('liveness ignores the DB; readiness bounds hangs, recovers and fails while draining', async () => {
  let attempts = 0;
  const app = fixture({ check: async () => { if (++attempts === 1) throw new Error('database secret'); } });
  await request(app).get('/health/live').expect(200); assert.equal(attempts, 0);
  await request(app).get('/health/ready').expect(503);
  await request(app).get('/health').expect(200);
  app.locals.health.drain();
  await request(app).get('/health/ready').expect(503);
  await request(app).get('/health/live').expect(200);
  assert.equal((await request(app).get('/api/events').expect(503)).body.error.code, 'SERVICE_DRAINING');
  let probes = 0;
  const hanging = createHealth({ check: () => { probes++; return new Promise(() => {}); }, timeoutMs: 10 });
  assert.deepEqual(await Promise.all([hanging.ready(), hanging.ready()]), [false, false]);
  assert.equal(await hanging.ready(), false); assert.equal(probes, 1);
});

test('metrics require authenticated internal access and never return raw private data', async () => {
  await request(fixture()).get('/api/admin/diagnostics/metrics').expect(401);
  const forbidden = fixture({ permissions: { assertInternal: async () => { throw new DomainError('Forbidden', { status: 403 }); } } });
  await request(forbidden).get('/api/admin/diagnostics/metrics').set('Authorization', 'Bearer private').expect(403);
  const response = await request(fixture()).get('/api/admin/diagnostics/metrics').set('Authorization', 'Bearer private').expect(200);
  assert.equal(response.body.data.scope, 'process'); assert.equal(response.headers['cache-control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(response.body), /private/);
});

test('database and HTTP deadlines are bounded and invalid values fail configuration', async () => {
  const config = getConfig({ NODE_ENV: 'test' }), db = createSequelize(config);
  assert.equal(db.options.dialectOptions.statement_timeout, 120000);
  assert.equal(db.options.dialectOptions.lock_timeout, 10000);
  assert.equal(db.options.dialectOptions.idle_in_transaction_session_timeout, 120000);
  assert.equal(db.options.dialectOptions.connectionTimeoutMillis, 10000);
  assert.equal(db.options.pool.acquire, 30000); await db.close();
  for (const key of ['READINESS_TIMEOUT_MS', 'API_SHUTDOWN_TIMEOUT_MS', 'DATABASE_STATEMENT_TIMEOUT_MS', 'DATABASE_LOCK_TIMEOUT_MS', 'DATABASE_CONNECT_TIMEOUT_MS', 'DATABASE_ACQUIRE_TIMEOUT_MS', 'DATABASE_IDLE_TRANSACTION_TIMEOUT_MS', 'HTTP_REQUEST_TIMEOUT_MS']) {
    assert.throws(() => getConfig({ [key]: '0' })); assert.throws(() => getConfig({ [key]: 'invalid' }));
  }
});

test('shutdown drains once, closes idle sockets and exits within a referenced deadline', async () => {
  let forced = 0, closed = 0, idle = 0; const exits = [], events = [], health = createHealth({ check: async () => {} });
  const shutdown = createShutdown({ server: { close: callback => callback(), closeIdleConnections: () => idle++, closeAllConnections: () => forced++ },
    sequelize: { close: () => { closed++; return new Promise(() => {}); } }, health,
    diagnostics: { log: (event, fields) => events.push({ event, ...fields }) }, timeoutMs: 15, exit: code => exits.push(code) });
  const result = shutdown(); assert.equal(shutdown(), result); assert.equal(await health.ready(), false);
  assert.equal(await result, 1); assert.deepEqual(exits, [1]); assert.equal(closed, 1); assert.equal(idle, 1); assert.equal(forced, 1); assert.equal(events[0].outcome, 'forced');
  const graceful = createShutdown({ server: { close: callback => callback() }, sequelize: { close: async () => {} }, health,
    diagnostics: { log() {} }, timeoutMs: 50, exit: code => exits.push(code) });
  assert.equal(await graceful(), 0);
  const failedStartup = createShutdown({ server: { close: callback => callback() }, sequelize: { close: async () => {} }, health,
    diagnostics: { log() {} }, timeoutMs: 50, exit: code => exits.push(code) });
  assert.equal(await failedStartup(1), 1);
  const signal = createShutdown({ server: { close: callback => callback() }, sequelize: { close: async () => {} }, health,
    diagnostics: { log() {} }, timeoutMs: 50, exit: code => exits.push(code) });
  assert.equal(await signal('SIGTERM'), 0);
});

test('invalid startup configuration fails without logging secrets or a raw stack', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_ENV: 'production', AUTH_TOKEN_SECRET: 'TOP_SECRET_PASSWORD', DATABASE_URL: 'postgres://TOP_SECRET_PASSWORD@private.invalid/db' },
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /TOP_SECRET_PASSWORD|private\.invalid|ZodError|at main|node:internal/);
  assert.equal(JSON.parse(result.stdout.trim()).event, 'api_startup_failed');
});

test('an occupied API port exits with failure and safe startup diagnostics within its deadline', { timeout: 10000 }, async () => {
  const occupied = http.createServer();
  await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve); });
  let child;
  try {
    const result = await new Promise((resolve, reject) => {
      const environment = { ...process.env, NODE_ENV: 'test', HOSTED_DEMO: 'false', PORT: String(occupied.address().port),
        LOG_LEVEL: 'info', API_SHUTDOWN_TIMEOUT_MS: '1000', DATABASE_URL: 'postgres://test:test@127.0.0.1:1/nitewide_unit_no_database', DATABASE_SSL: 'false',
        MEDIA_STORAGE_DRIVER: 'local', MEDIA_CLEANUP_ENABLED: 'false', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', RESEND_TEST_MODE: 'false',
        R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_ENDPOINT: '',
      };
      child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('API startup failure did not exit within five seconds')); }, 5000);
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ code, signal, stdout, stderr }); });
    });
    assert.equal(result.code, 1); assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /postgres:|nitewide_unit_no_database|EADDRINUSE|node:internal|at main|password/);
    const records = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(records.some(record => record.event === 'api_startup_failed'));
    assert.ok(records.some(record => record.event === 'api_shutdown' && record.outcome === 'error'));
    assert.ok(!records.some(record => record.event === 'api_started'));
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    await new Promise(resolve => occupied.close(resolve));
  }
});
