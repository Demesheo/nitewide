const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');
const { createEmailService } = require('../src/services/email-service');
const request = require('supertest');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { QueryTypes } = require('sequelize');

test('durable email workers with mocked provider, leases, safe replay and internal operations', { timeout: 30000 }, async t => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const db = require('../src/db/sequelize').createSequelize(config);
  const models = require('../src/db/models').initModels(db);
  let clock = new Date(); const key = 'mock-only-encryption-key-never-provider';
  let sends = 0, inFlight = 0, peak = 0;
  const base = { sequelize: db, models, apiKey: 'mock-only', from: 'onboarding@resend.dev', encryptionKey: key, now: () => clock, batchSize: 4,
    fetchImpl: async () => { sends++; inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 10)); inFlight--; return { ok: true, json: async () => ({ id: randomUUID() }) }; } };
  const message = { to: 'delivered+worker@resend.dev', template: 'nitewide-welcome', variables: { NAME: 'Worker' } };
  try {
    const { ids } = await createFixture(models, config);
    await models.EmailOutbox.destroy({ where: {} });
    const one = createEmailService({ ...base, concurrency: 2 }), two = createEmailService({ ...base, concurrency: 1 });
    await t.test('concurrent workers send each row once and enforce per-worker bounds', async () => {
      for (let n = 0; n < 6; n++) await one.queue({ ...message, key: `worker/${n}` });
      await Promise.all([one.drain(), two.drain()]);
      assert.equal(sends, 6); assert.ok(peak <= 3 && peak >= 2);
      assert.equal(await models.EmailOutbox.count({ where: { status: 'sent' } }), 6);
      const row = await models.EmailOutbox.findOne(); assert.equal(row.encryptedVariables, null);
      assert.equal(row.attemptHistory[0].status, 'sent'); assert.equal(row.attemptCount, 1);
    });
    await t.test('expired processing lease recovers; active lease is untouched', async () => {
      const lost = await one.queue({ ...message, key: 'lost-lease' }), held = await one.queue({ ...message, key: 'active-lease' });
      await models.EmailOutbox.update({ status: 'processing', leaseToken: randomUUID(), leaseUntil: new Date(clock.getTime() - 1) }, { where: { id: lost } });
      await models.EmailOutbox.update({ status: 'processing', leaseToken: randomUUID(), leaseUntil: new Date(clock.getTime() + 120000) }, { where: { id: held } });
      assert.equal(await one.drain(), 1); assert.equal((await models.EmailOutbox.findByPk(lost)).status, 'sent');
      assert.equal((await models.EmailOutbox.findByPk(held)).status, 'processing');
      await models.EmailOutbox.destroy({ where: { id: held } });
    });
    const failing = createEmailService({ ...base, fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '60' }, json: async () => ({ name: 'rate_limit' }) }) });
    let failedId;
    await t.test('retry timing and failed history remain visible, replay preserves stable payload/key', async () => {
      failedId = await failing.queue({ ...message, key: 'retry-job' });
      for (let n = 0; n < 5; n++) { await failing.drain(); const row = await models.EmailOutbox.findByPk(failedId); assert.ok(row.nextAttemptAt.getTime() >= clock.getTime() + 60000); clock = new Date(row.nextAttemptAt); }
      const row = await models.EmailOutbox.findByPk(failedId);
      assert.equal(row.status, 'failed'); assert.equal(row.attemptCount, 5); assert.equal(row.attemptHistory.length, 5);
      const listing = await failing.list(); assert.equal(listing.count, 1); assert.equal(listing.rows[0].encryptedVariables, undefined);
      await db.transaction(transaction => one.replay(failedId, transaction)); await one.drain();
      const delivered = await models.EmailOutbox.findByPk(failedId); assert.equal(delivered.status, 'sent'); assert.equal(delivered.attemptCount, 6); assert.equal(delivered.replayCount, 1);
    });
    await t.test('ambiguous sends older than idempotency window are never automatically resent or replayed', async () => {
      const id = await one.queue({ ...message, key: 'too-old' });
      await models.EmailOutbox.update({ firstAttemptAt: new Date(clock.getTime() - 24*3600000) }, { where: { id } });
      const before = sends; await one.drain(); assert.equal(sends, before);
      assert.equal((await models.EmailOutbox.findByPk(id)).lastError, 'IDEMPOTENCY_WINDOW_EXPIRED');
      await db.transaction(async transaction => { await assert.rejects(one.replay(id, transaction), { status: 409 }); });
    });
    await t.test('internal APIs require admin, validate reasons, and audit queued replay without sending', async () => {
      const email = createEmailService({ ...base, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ name: 'validation_error' }) }) });
      const id = await email.queue({ ...message, key: 'admin-retry' }); await email.drain();
      const app = require('../src/app').createApp({ sequelize: db, models, config, services: { email } });
      const client = actor => request(app).get('/api/admin/background/email').set('x-user-id',actor);
      await client(ids.owner).expect(403); const list = await client(ids.admin).expect(200);
      assert.ok(list.body.data.items.some(row => row.id === id)); assert.equal(JSON.stringify(list.body).includes('encryptedVariables'), false);
      await request(app).post(`/api/admin/background/email/${id}/replay`).set('x-user-id',ids.admin).send({ reason: 'x' }).expect(422);
      await request(app).post(`/api/admin/background/email/${id}/replay`).set('x-user-id',ids.admin).send({ reason: 'Inspected provider rejection' }).expect(202);
      assert.equal(await models.AuditLog.count({ where: { entityId: id, action: 'background.email.replay' } }), 1);
      assert.equal((await models.EmailOutbox.findByPk(id)).status, 'pending');
    });
    await t.test('essential staging delivery blocks old nonessential jobs and manual replay, but sends all three account actions', async () => {
      await models.EmailOutbox.destroy({ where: {} });
      const { TEMPLATES } = require('../src/services/email-templates');
      const { ESSENTIAL_TEMPLATES } = require('../src/services/email-delivery-policy');
      const essential = createEmailService({ ...base, deliveryPolicy: 'essential', batchSize: 25 });
      const blocked = [];
      for (const template of [TEMPLATES.welcome, TEMPLATES.purchaseReceipt, TEMPLATES.teamInvitation, 'unknown-template']) {
        assert.equal(await essential.queue({ ...message, key: `suppressed/${template}`, template }), null);
        blocked.push(await one.queue({ ...message, key: `old/${template}`, template }));
      }
      await models.EmailOutbox.update({ status: 'failed' }, { where: { id: blocked[2] } });
      await db.transaction(transaction => assert.rejects(essential.replay(blocked[2], transaction), { status: 409 }));
      await models.EmailOutbox.update({ status: 'pending' }, { where: { id: blocked[2] } });
      const allowed = [];
      for (const template of ESSENTIAL_TEMPLATES) allowed.push(await essential.queue({ ...message, key: `essential/${template}`, template,
        variables: { NAME: 'Staging User', VERIFY_URL: 'https://staging.example.test/?verifyEmail=private', RESET_URL: 'https://staging.example.test/?resetPassword=private',
          SETUP_URL: 'https://business-staging.example.test/app?onboarding=private', EXPIRES_AT: new Date(clock.getTime() + 86400000).toISOString(), ACCOUNT_MODE: 'existing' } }));
      const before = sends;
      assert.equal(await essential.drain(), 7);
      assert.equal(sends - before, 3);
      for (const id of blocked) {
        const row = await models.EmailOutbox.findByPk(id);
        assert.equal(row.status, 'failed'); assert.equal(row.lastError, 'EMAIL_POLICY_BLOCKED');
        assert.equal(row.encryptedVariables, null); assert.equal(row.providerMessageId, null);
        await db.transaction(transaction => assert.rejects(essential.replay(id, transaction), { status: 409 }));
      }
      for (const id of allowed) assert.equal((await models.EmailOutbox.findByPk(id)).status, 'sent');
    });
    await t.test('stop waits for current send and does not claim another wave', async () => {
      await models.EmailOutbox.destroy({ where: {} });
      let entered, release; const begun = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const worker = createEmailService({ ...base, concurrency: 1, fetchImpl: async () => { entered(); await gate; return { ok: true, json: async () => ({ id: 'held-send' }) }; } });
      await worker.queue({ ...message, key: 'stop/one' }); await worker.queue({ ...message, key: 'stop/two' });
      const active = worker.drain(); await begun; const stopping = worker.stop(); release();
      await stopping; assert.equal(await active, 1); assert.equal(await worker.drain(), 0);
      assert.equal(await models.EmailOutbox.count({ where: { status: 'pending' } }), 1);
    });
    await t.test('ambiguous provider acceptance reuses the key and sender; a stale token cannot complete a new lease', async () => {
      await models.EmailOutbox.destroy({ where: {} });
      const calls = []; let accepted = false;
      const provider = async (_url, options) => {
        calls.push({ key: options.headers['Idempotency-Key'], body: options.body });
        if (!accepted) { accepted = true; throw Object.assign(new Error('Accepted then connection lost'), { code: 'ECONNRESET' }); }
        return { ok: true, json: async () => ({ id: 'original-provider-id' }) };
      };
      const first = createEmailService({ ...base, fetchImpl: provider });
      const id = await first.queue({ ...message, key: 'ambiguous' }); await first.drain();
      clock = (await models.EmailOutbox.findByPk(id)).nextAttemptAt;
      const replacement = createEmailService({ ...base, from: 'different@example.org', fetchImpl: provider }); await replacement.drain();
      assert.deepEqual(calls[0], calls[1]); assert.equal((await models.EmailOutbox.findByPk(id)).providerMessageId, 'original-provider-id');
      const staleId = await first.queue({ ...message, key: 'stale-owner' });
      const stolenToken = randomUUID();
      const stale = createEmailService({ ...base, fetchImpl: async () => {
        await models.EmailOutbox.update({ leaseToken: stolenToken }, { where: { id: staleId } });
        return { ok: true, json: async () => ({ id: 'late-response' }) };
      } });
      await stale.drain(); const row = await models.EmailOutbox.findByPk(staleId);
      assert.equal(row.status, 'processing'); assert.equal(row.leaseToken, stolenToken); assert.equal(row.providerMessageId, null);
    });
    await t.test('shared database pacing works with mocked provider requests', async () => {
      await models.EmailOutbox.destroy({ where: {} });
      const worker = createEmailService({ ...base, requestIntervalMs: 500 });
      await worker.queue({ ...message, key: 'paced/one' }); await worker.queue({ ...message, key: 'paced/two' });
      assert.equal(await worker.drain(), 2);
      assert.equal(await models.EmailOutbox.count({ where: { status: 'sent' } }), 2);
    });
    await t.test('standalone worker process starts without HTTP and handles SIGTERM cleanly with email disabled', { timeout: 10000 }, async () => {
      const child = spawn(process.execPath, [require.resolve('../src/worker')], {
        env: { ...process.env, RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', RESEND_TEST_MODE: 'false', WORKER_POLL_INTERVAL_MS: '250', LOG_LEVEL: 'info' },
        stdio: ['ignore','pipe','pipe'],
      });
      const closed = once(child, 'close'); let output = '';
      try {
        await new Promise((resolve, reject) => {
          const deadline = setTimeout(() => finish(new Error('Worker did not emit its structured startup event within 8 seconds')), 8000);
          let settled = false;
          function finish(error) {
            if (settled) return;
            settled = true; clearTimeout(deadline);
            if (error) reject(error); else resolve();
          }
          child.on('error', finish);
          child.once('exit', code => finish(new Error(`Worker exited before startup (${code})`)));
          child.stdout.on('data', data => {
            output += data;
            if (output.split('\n').some(line => {
              try { return JSON.parse(line).event === 'worker_started'; } catch { return false; }
            })) finish();
          });
        });
        const active = await db.query("SELECT * FROM background_workers WHERE status='running'", { type: QueryTypes.SELECT });
        assert.equal(active.length, 1); assert.equal(active[0].details.emailEnabled, false);
        child.kill('SIGTERM'); const [code, signal] = await closed;
        assert.equal(code, 0); assert.equal(signal, null);
        const [stopped] = await db.query('SELECT status FROM background_workers WHERE id=:id', { replacements: { id: active[0].id }, type: QueryTypes.SELECT });
        assert.equal(stopped.status, 'stopped');
      } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
    });
  } finally { await db.close(); }
});
