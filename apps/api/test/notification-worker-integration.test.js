const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { assertManagedTestDatabase } = require('../scripts/test-database.cjs');
const { createFixture } = require('./admissions-fixture.cjs');
const { createNotificationJobService, BATCH_SIZE } = require('../src/services/notification-job-service');
const { createCheckoutService } = require('../src/services/checkout-service');

test('durable checkout notification worker: rollback, leases, preferences, revocation, checkpoints and audited replay', { timeout: 90000 }, async (t) => {
  assertManagedTestDatabase();
  const config = require('../src/config').getConfig();
  const db = require('../src/db/sequelize').createSequelize(config);
  const query = db.query.bind(db);
  db.query = async (...args) => { try { return await query(...args); } catch (error) { t.diagnostic(`${error.name}: ${error.message}`); throw error; } };
  const m = require('../src/db/models').initModels(db);
  const q = (sql, replacements = {}) => db.query(sql, { replacements, type: QueryTypes.SELECT });
  try {
    const { ids } = await createFixture(m, config);
    const worker = createNotificationJobService({ sequelize: db, models: m, concurrency: 2 });
    const competitor = createNotificationJobService({ sequelize: db, models: m, concurrency: 1 });
    const affiliate = await m.EventAffiliate.findOne({ where: { eventId: ids.event, userId: ids.promoter } });
    const offering = await m.Offering.create({ eventId: ids.event, name: 'Worker fixture ticket', kind: 'ticket', priceCents: 1000,
      currency: 'USD', inventoryMode: 'finite', quantityTotal: 1, quantitySold: 0, entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 1 });
    const checkout = createCheckoutService({ sequelize: db, models: m, email: null, notificationJobs: worker });
    const input = { eventId: ids.event, buyerUserId: ids.guest, idempotencyKey: randomUUID(), affiliateCode: affiliate.code,
      items: [{ offeringId: offering.id, quantity: 1 }], payment: { provider: 'demo', reference: randomUUID(), status: 'succeeded' } };
    let result;
    await t.test('checkout commits one job, no fanout writes, and rollback never leaves a queued job', async () => {
      const rejecting = createCheckoutService({ sequelize: db, models: m, notificationJobs: { enqueueCheckout: async (payload, transaction) => {
        await worker.enqueueCheckout(payload, transaction); throw new Error('Fail checkout after enqueue');
      } } });
      await assert.rejects(rejecting({ ...input, idempotencyKey: randomUUID() }), /Fail checkout after enqueue/);
      assert.equal(await m.NotificationJob.count(), 0);
      assert.equal((await offering.reload()).quantitySold, 0);
      result = await checkout(input);
      assert.equal(await m.Notification.count(), 0, 'fan-out is outside checkout');
      assert.equal(await m.NotificationJob.count(), 1);
      assert.equal((await checkout(input)).replayed, true);
      assert.equal(await m.NotificationJob.count(), 1, 'idempotent checkout does not enqueue a second job');
      const [job] = await q('SELECT * FROM notification_jobs');
      assert.equal(job.payload.orderId, result.order.id);
      assert.equal(job.payload.soldOutOfferings[0].id, offering.id);
    });
    await t.test('competing workers exclusively claim one job and preserve notification contents', async () => {
      const claimed = await Promise.all([worker.drain(), competitor.drain()]);
      assert.equal(claimed.reduce((sum, count) => sum+count, 0), 1);
      const rows = await m.Notification.findAll({ where: { eventId: ids.event } });
      assert.equal(rows.length, 6);
      assert.equal(rows.filter((row) => row.kind === 'purchase_confirmed').length, 1);
      assert.equal(rows.filter((row) => row.kind === 'referral_purchase').length, 1);
      assert.equal(rows.filter((row) => row.kind === 'event_purchase').length, 2);
      assert.equal(rows.filter((row) => row.kind === 'offering_sold_out').length, 2);
      assert.ok(rows.every((row) => row.metadata.orderId === result.order.id));
      assert.equal(await worker.drain(), 0);
      const [job] = await q('SELECT * FROM notification_jobs');
      assert.equal(job.status, 'completed'); assert.equal(job.processed_deliveries, job.total_deliveries);
    });
    async function queue(extra = {}) {
      const order = await m.Order.create({ eventId: ids.event, buyerUserId: ids.guest, status: 'paid', currency: 'USD', subtotalCents: 1000,
        totalCents: 1000, paidAt: new Date(), idempotencyKey: randomUUID() });
      return db.transaction((transaction) => worker.enqueueCheckout({ orderId: order.id, eventId: ids.event, eventTitle: 'Worker snapshot title',
        buyerUserId: ids.guest, referrerUserId: ids.promoter, eventAffiliateId: affiliate.id, orgAffiliateId: null,
        names: '1 × Worker fixture ticket', subtotalCents: 1000, commissionCents: 100, demo: false,
        soldOutOfferings: [{ id: offering.id, name: offering.name }], ...extra }, transaction));
    }
    await t.test('worker rechecks suspended recipients, revoked affiliation and current preferences', async () => {
      const job = await queue();
      await m.OrganizationOwner.update({ lifecycleState: 'suspended' }, { where: { userId: ids.manager, organizationId: ids.org } });
      await m.EventAffiliate.update({ status: 'inactive' }, { where: { id: affiliate.id } });
      await m.User.update({ notificationPreferences: { salesActivity: false, inventoryAlerts: false } }, { where: { id: ids.owner } });
      await worker.drain();
      const rows = await m.Notification.findAll();
      assert.equal(rows.filter((row) => row.metadata.orderId === job.orderId).length, 1, 'only essential buyer confirmation survives');
      await m.OrganizationOwner.unscoped().update({ lifecycleState: 'active' }, { where: { userId: ids.manager, organizationId: ids.org } });
      await m.EventAffiliate.update({ status: 'active' }, { where: { id: affiliate.id } });
      await m.User.update({ notificationPreferences: {} }, { where: { id: ids.owner } });
    });
    await t.test('a crash after notification insertion rolls back both the write and checkpoint', async () => {
      const job = await queue();
      const original = m.Notification.create.bind(m.Notification);
      m.Notification.create = async (...args) => { await original(...args); throw new Error('Simulated process failure after notification write'); };
      try { await worker.drain(); } finally { m.Notification.create = original; }
      const [failed] = await q('SELECT * FROM notification_jobs WHERE id=:id', { id: job.id });
      assert.equal(failed.status, 'retry'); assert.equal(failed.processed_deliveries, 0);
      assert.equal(await m.Notification.count({ where: { metadata: { orderId: job.orderId } } }), 0);
      assert.equal(await worker.drain(), 0, 'backoff does not immediately reclaim retry jobs');
      await q("UPDATE notification_jobs SET attempts=4,available_at=NOW()-INTERVAL '1 second' WHERE id=:id", { id: job.id });
      m.Notification.create = async (...args) => { await original(...args); throw new Error('Still failing'); };
      try { await worker.drain(); } finally { m.Notification.create = original; }
      assert.equal((await q('SELECT status FROM notification_jobs WHERE id=:id', { id: job.id }))[0].status, 'failed', 'fifth failed attempt is terminal');
      await assert.rejects(worker.replay(ids.guest, job.id, { reason: 'Fixture replay' }), { code: 'FORBIDDEN' });
      await assert.rejects(worker.list(ids.guest), { code: 'FORBIDDEN' });
      const audit = m.AuditLog.create.bind(m.AuditLog);
      m.AuditLog.create = async (...args) => { await audit(...args); throw new Error('Audit write interrupted'); };
      try { await assert.rejects(worker.replay(ids.admin, job.id, { reason: 'Fixture audit rollback' }), /Audit write interrupted/); }
      finally { m.AuditLog.create = audit; }
      assert.equal((await q('SELECT status FROM notification_jobs WHERE id=:id', { id: job.id }))[0].status, 'failed');
      assert.equal(await m.AuditLog.count({ where: { entityId: job.id } }), 0, 'replay and audit roll back together');
      const replayed = await worker.replay(ids.admin, job.id, { reason: 'Confirmed transient worker failure' });
      assert.equal(replayed.status, 'pending'); assert.equal(replayed.payload, undefined);
      assert.equal(await m.AuditLog.count({ where: { entityId: job.id, action: 'notification_job.replay' } }), 1);
      assert.equal((await worker.list(ids.admin, { status: 'pending' })).items[0].payload, undefined);
      await worker.drain();
      assert.equal(await m.Notification.count({ where: { metadata: { orderId: job.orderId } } }), 6);
    });
    await t.test('bounded passes checkpoint fanout and expired leases resume without duplicates', async () => {
      const userIds = Array.from({ length: BATCH_SIZE+10 }, () => randomUUID());
      await m.User.bulkCreate(userIds.map((id) => ({ id, displayName: 'Worker manager', email: `${id}@worker.nitewide.test` })));
      await m.OrganizationOwner.bulkCreate(userIds.map((userId) => ({ organizationId: ids.org, userId, role: 'admin' })));
      const job = await queue({ referrerUserId: null, eventAffiliateId: null, soldOutOfferings: [] });
      assert.equal(await worker.drain({ maxJobs: 1, maxBatches: 1 }), 1);
      const [checkpoint] = await q('SELECT * FROM notification_jobs WHERE id=:id', { id: job.id });
      assert.equal(checkpoint.processed_deliveries, BATCH_SIZE); assert.equal(checkpoint.status, 'retry'); assert.equal(checkpoint.attempts, 0);
      // Membership removal after planning must still suppress delivery.
      const [pending] = await q('SELECT * FROM notification_job_deliveries WHERE job_id=:id AND processed_at IS NULL LIMIT 1', { id: job.id });
      await m.OrganizationOwner.update({ lifecycleState: 'suspended' }, { where: { organizationId: ids.org, userId: pending.user_id } });
      await q("UPDATE notification_jobs SET status='running',lease_token=:token,lease_until=NOW()-INTERVAL '1 minute' WHERE id=:id", { id: job.id, token: randomUUID() });
      await competitor.drain();
      const [finished] = await q('SELECT * FROM notification_jobs WHERE id=:id', { id: job.id });
      assert.equal(finished.status, 'completed'); assert.equal(finished.processed_deliveries, finished.total_deliveries);
      const notifications = await m.Notification.findAll({ where: { metadata: { orderId: job.orderId } } });
      assert.equal(notifications.length, finished.total_deliveries-1);
      assert.equal(new Set(notifications.map((row) => `${row.userId}:${row.kind}`)).size, notifications.length);
      assert.ok(!notifications.some((row) => row.userId === pending.user_id));
      const stopJob = await queue({ referrerUserId: null, eventAffiliateId: null, soldOutOfferings: [] });
      const stoppingWorker = createNotificationJobService({ sequelize: db, models: m, concurrency: 1 });
      const original = m.Notification.create.bind(m.Notification); let stopPromise;
      m.Notification.create = async (...args) => {
        const row = await original(...args);
        if (!stopPromise) stopPromise = stoppingWorker.stop();
        return row;
      };
      try { await stoppingWorker.drain(); await stopPromise; } finally { m.Notification.create = original; }
      const [paused] = await q('SELECT * FROM notification_jobs WHERE id=:id', { id: stopJob.id });
      assert.equal(paused.status, 'retry'); assert.equal(paused.processed_deliveries, BATCH_SIZE);
      await competitor.drain();
      const [resumed] = await q('SELECT * FROM notification_jobs WHERE id=:id', { id: stopJob.id });
      assert.equal(resumed.status, 'completed');
      assert.equal(await m.Notification.count({ where: { metadata: { orderId: stopJob.orderId } } }), resumed.total_deliveries);
      assert.equal(await stoppingWorker.drain(), 0, 'stopped instance does not claim another job');
      await worker.stop(); assert.equal(await worker.drain(), 0);
    });
  } finally { await db.close(); }
});
