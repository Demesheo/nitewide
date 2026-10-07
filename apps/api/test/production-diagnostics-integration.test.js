const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');

test('production diagnostics use real PostgreSQL deadlines and authorized HTTP telemetry', { timeout: 45000 }, async t => {
  assertManagedTestDatabase();
  const { getConfig } = require('../src/config');
  const { createSequelize } = require('../src/db/sequelize');
  const { initModels } = require('../src/db/models');
  const { createApp } = require('../src/app');
  const config = getConfig({ ...process.env, DATABASE_STATEMENT_TIMEOUT_MS: '1000', DATABASE_LOCK_TIMEOUT_MS: '100', DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: '1000', LOG_LEVEL: 'silent' });
  const db = createSequelize(config), models = initModels(db);
  try {
    const { ids } = await createFixture(models, config);
    const app = createApp({ sequelize: db, models, config, services: { email: { enabled: false } } });
    const query = sql => db.query(sql, { type: QueryTypes.SELECT });
    await t.test('server connections enforce statement lock and idle transaction timeouts', async () => {
      assert.equal((await query('SHOW statement_timeout'))[0].statement_timeout, '1s');
      assert.equal((await query('SHOW lock_timeout'))[0].lock_timeout, '100ms');
      assert.equal((await query('SHOW idle_in_transaction_session_timeout'))[0].idle_in_transaction_session_timeout, '1s');
      await assert.rejects(query('SELECT pg_sleep(2)'), error => error.original?.code === '57014');
      const lock = await db.transaction();
      try {
        await db.query('SELECT pg_advisory_xact_lock(782136)', { transaction: lock });
        await assert.rejects(db.transaction(transaction => db.query('SELECT pg_advisory_xact_lock(782136)', { transaction })), error => error.original?.code === '55P03');
      } finally { await lock.rollback(); }
      // A canceled statement must not poison later pooled connections.
      assert.equal((await query('SELECT 1 AS ready'))[0].ready, 1);
      assert.ok(db.diagnostics.snapshot().queries.some(value => value.key.endsWith(' timeout') && value.count >= 1));
    });
    await t.test('HTTP validation and authorization errors remain stable with correlation IDs', async () => {
      const id = '10000000-0000-4000-8000-000000000001';
      const unauthorized = await request(app).get('/api/admin/diagnostics/metrics').set('x-request-id', id).expect(401);
      assert.equal(unauthorized.body.error.requestId, id);
      await request(app).get('/api/admin/diagnostics/metrics').set('x-user-id', ids.guest).expect(403);
      const metrics = await request(app).get('/api/admin/diagnostics/metrics').set('x-user-id', ids.admin).expect(200);
      assert.ok(metrics.body.data.queries.some(value => value.key.endsWith(' timeout')));
      assert.ok(metrics.body.data.requests.some(value => value.key.includes('4xx')));
      assert.doesNotMatch(JSON.stringify(metrics.body), /postgres:|nitewide_test_|@|password|pg_sleep|782136/);
      const malformed = await request(app).post('/api/auth/sign-in').set('Content-Type', 'application/json').send('{"email":').expect(400);
      assert.equal(malformed.body.error.code, 'MALFORMED_JSON');
      const validation = await request(app).post('/api/auth/sign-in').send({ email: 'invalid', password: '' }).expect(422);
      assert.equal(validation.body.error.code, 'VALIDATION_ERROR');
    });
    await t.test('real DB readiness recovers after failures and respects draining', async () => {
      let fail = true;
      const probe = createApp({ sequelize: db, models, config, services: { email: { enabled: false } }, healthCheck: async () => {
        if (fail) await query('SELECT 1 FROM intentionally_missing_readiness_table');
        else await db.authenticate();
      } });
      await request(probe).get('/health/live').expect(200);
      await request(probe).get('/health/ready').expect(503);
      fail = false;
      await request(probe).get('/health').expect(200);
      probe.locals.health.drain();
      await request(probe).get('/health/ready').expect(503);
      await request(probe).get('/health/live').expect(200);
      await request(probe).get('/api/events').expect(503);
    });
    await t.test('deployment readiness rejects stale, mismatched and stopped worker heartbeats', async () => {
      const { randomUUID } = require('node:crypto');
      const { paymentRuntimeEvidence } = require('../src/diagnostics/payment-runtime');
      const releaseConfig = { ...config, RELEASE_REVISION: 'a'.repeat(40), APP_ENVIRONMENT: 'staging', EMAIL_DELIVERY_POLICY: 'essential' };
      const runtime = paymentRuntimeEvidence(releaseConfig), id = randomUUID();
      const probe = createApp({ sequelize: db, models, config: releaseConfig, services: { email: { enabled: false } } });
      try {
        await request(probe).get('/health/ready?requireWorker=true').expect(503);
        await db.query(`INSERT INTO background_workers(id,status,heartbeat_at,details) VALUES(:id,'running',NOW(),CAST(:details AS jsonb))`,
          { replacements: { id, details: JSON.stringify({ paymentRuntime: runtime }) } });
        await request(probe).get('/health/ready?requireWorker=true').expect(200).expect('X-Nitewide-Revision', runtime.revision);
        for (const sql of [
          "heartbeat_at=NOW()-INTERVAL '60 seconds'", "heartbeat_at=NOW()+INTERVAL '60 seconds'", "status='stopped'",
          "details=jsonb_set(details,'{paymentRuntime,revision}','\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"')",
          "details=jsonb_set(details,'{paymentRuntime,configurationFingerprint}','\"different\"')",
        ]) {
          await db.query(`UPDATE background_workers SET status='running',heartbeat_at=NOW(),details=CAST(:details AS jsonb) WHERE id=:id`,
            { replacements: { id, details: JSON.stringify({ paymentRuntime: runtime }) } });
          await db.query(`UPDATE background_workers SET ${sql} WHERE id=:id`, { replacements: { id } });
          await request(probe).get('/health/ready?requireWorker=true').expect(503);
          await request(probe).get('/health/ready').expect(200);
        }
      } finally { await db.query('DELETE FROM background_workers WHERE id=:id', { replacements: { id } }); }
    });
  } finally { await db.close(); }
});
