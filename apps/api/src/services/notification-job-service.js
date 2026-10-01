const { randomUUID } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { createNotificationService } = require('./notification-service');
const { createPermissionService } = require('./permission-service');
const { mutationTransaction } = require('./mutation-transaction');
const { base } = require('./business-read-service');
const { activeUser } = require('./lifecycle-service');
const { conflict, notFound } = require('../domain/errors');

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;
function checkoutMessage(payload, delivery, buyer, referrer) {
  const { demo, names, eventTitle, subtotalCents, commissionCents } = payload;
  const metadata = { orderId: payload.orderId, referrerUserId: payload.referrerUserId || null, demo };
  const suffix = demo ? ' (demo only)' : '';
  const messages = {
    purchase_confirmed: [demo ? 'Demo booking recorded' : 'Purchase confirmed', `${names} for ${eventTitle} · ${demo ? 'demo only, no charge' : 'confirmed'}.`],
    referral_purchase: [demo ? 'Demo referral sale' : 'Referral sale', `${buyer?.displayName || 'A customer'} booked ${names} for ${eventTitle}. Sale ${subtotalCents / 100} USD; your commission ${(commissionCents || 0) / 100} USD${suffix}.`],
    event_purchase: [demo ? 'Demo event sale' : 'Event sale', `${referrer ? `${referrer.displayName}'s customer` : buyer?.displayName || 'A customer'} booked ${names} for ${eventTitle}. Sale ${subtotalCents / 100} USD; commission ${(commissionCents || 0) / 100} USD${suffix}.`],
    offering_sold_out: ['Ticket or package sold out', `${delivery.offering_name} for ${eventTitle} has sold out.`],
  };
  const [title, message] = messages[delivery.kind];
  return { userId: delivery.user_id, eventId: payload.eventId, kind: delivery.kind,
    title: title.slice(0, 160), message: message.slice(0, 500), metadata };
}

function createNotificationJobService({ sequelize, models, now = () => new Date(), concurrency = 2 }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Notification concurrency must be an integer from 1 to 8');
  const select = (sql, replacements = {}, transaction) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  const notifications = createNotificationService(models);
  const permissions = createPermissionService(models);
  let stopping = false; let active = null;
  async function enqueueCheckout(payload, transaction) {
    if (!transaction) throw new Error('Checkout notification enqueue requires its transaction');
    const [job] = await models.NotificationJob.findOrCreate({ where: { orderId: payload.orderId },
      defaults: { id: randomUUID(), payload, status: 'pending', availableAt: now() }, transaction });
    return job;
  }
  async function locked(job, transaction) {
    const [row] = await select('SELECT * FROM notification_jobs WHERE id=:id AND lease_token=:token AND status=\'running\' FOR UPDATE',
      { id: job.id, token: job.lease_token }, transaction);
    if (!row) throw conflict('Notification lease lost', 'NOTIFICATION_LEASE_LOST');
    return row;
  }
  async function plan(job) {
    return mutationTransaction(sequelize, async (transaction) => {
      const current = await locked(job, transaction);
      if (current.planned_at) return current;
      const p = current.payload;
      // Resolve the audience in the worker, not while checkout owns inventory locks.
      // SQL materializes the recipient plan without loading an unbounded staff array.
      await select(`WITH leaders AS (
        SELECT oo.user_id FROM events e JOIN organization_owners oo ON oo.organization_id=e.organization_id
        WHERE e.id=:eventId AND oo.lifecycle_state='active'
        UNION SELECT e.creator_user_id FROM events e WHERE e.id=:eventId AND e.organization_id IS NULL),
        candidates AS (
          SELECT CAST(:buyer AS uuid) AS user_id,'purchase_confirmed'::text AS kind,NULL::text AS offering_id,NULL::text AS offering_name
          UNION ALL SELECT CAST(:referrer AS uuid),'referral_purchase',NULL,NULL WHERE CAST(:referrer AS uuid) IS NOT NULL
          UNION ALL SELECT user_id,'event_purchase',NULL,NULL FROM leaders WHERE user_id<>CAST(:buyer AS uuid)
            AND (CAST(:referrer AS uuid) IS NULL OR user_id<>CAST(:referrer AS uuid))
          UNION ALL SELECT user_id,'offering_sold_out',offering->>'id',offering->>'name'
            FROM leaders CROSS JOIN jsonb_array_elements(CAST(:soldOut AS jsonb)) offering)
        INSERT INTO notification_job_deliveries(job_id,dedupe_key,user_id,kind,offering_name)
        SELECT :id,jsonb_build_array(user_id,kind,offering_id)::text,user_id,kind,offering_name FROM candidates
        ON CONFLICT DO NOTHING`, { id: job.id, eventId: p.eventId, buyer: p.buyerUserId, referrer: p.referrerUserId || null,
        soldOut: JSON.stringify(p.soldOutOfferings || []) }, transaction);
      const [updated] = await select(`UPDATE notification_jobs SET planned_at=:now,total_deliveries=(SELECT COUNT(*) FROM notification_job_deliveries WHERE job_id=:id),
        lease_until=CAST(:now AS timestamptz)+INTERVAL '1 minute',updated_at=:now WHERE id=:id RETURNING *`, { id: job.id, now: now() }, transaction);
      return updated;
    });
  }
  async function eligible(payload, delivery, transaction) {
    const user = await models.User.findByPk(delivery.user_id, { transaction });
    if (!activeUser(user)) return false;
    if (delivery.kind === 'purchase_confirmed') return delivery.user_id === payload.buyerUserId;
    const [event] = await select(`SELECT e.id,e.organization_id,e.creator_user_id FROM events e WHERE e.id=:eventId AND ${base}`,
      { eventId: payload.eventId, userId: delivery.user_id, isAdmin: false, canManageEvents: false }, transaction);
    if (!event) return false;
    if (delivery.kind === 'referral_purchase') {
      if (payload.eventAffiliateId) {
        const [affiliate] = await select(`SELECT id FROM event_affiliates WHERE id=:id AND event_id=:eventId AND user_id=:userId AND status='active'`,
          { id: payload.eventAffiliateId, eventId: payload.eventId, userId: delivery.user_id }, transaction);
        return Boolean(affiliate);
      }
      const [affiliate] = await select(`SELECT id FROM org_affiliates WHERE id=:id AND organization_id=:orgId AND user_id=:userId AND status='active'
        AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())`,
      { id: payload.orgAffiliateId || null, orgId: event.organization_id, userId: delivery.user_id }, transaction);
      return Boolean(affiliate);
    }
    if (!event.organization_id) return event.creator_user_id === delivery.user_id;
    const [leader] = await select(`SELECT id FROM organization_owners WHERE organization_id=:orgId AND user_id=:userId AND lifecycle_state='active'`,
      { orgId: event.organization_id, userId: delivery.user_id }, transaction);
    return Boolean(leader);
  }
  async function batch(job) {
    return mutationTransaction(sequelize, async (transaction) => {
      const current = await locked(job, transaction);
      const deliveries = await select(`SELECT * FROM notification_job_deliveries WHERE job_id=:id AND processed_at IS NULL
        ORDER BY dedupe_key LIMIT :limit FOR UPDATE`, { id: job.id, limit: BATCH_SIZE }, transaction);
      const buyer = await models.User.findByPk(current.payload.buyerUserId, { transaction });
      const referrer = current.payload.referrerUserId ? await models.User.findByPk(current.payload.referrerUserId, { transaction }) : null;
      for (const delivery of deliveries) {
        const notification = await eligible(current.payload, delivery, transaction)
          ? await notifications.emit(checkoutMessage(current.payload, delivery, buyer, referrer), transaction) : null;
        // The notification and checkpoint share this commit. A crash rolls back
        // both; replay sees processed rows and cannot emit a second notification.
        await select(`UPDATE notification_job_deliveries SET processed_at=:now,notification_id=:notificationId,skipped=:skipped
          WHERE job_id=:id AND dedupe_key=:key`, { id: job.id, key: delivery.dedupe_key, now: now(), notificationId: notification?.id || null, skipped: !notification }, transaction);
      }
      const [updated] = await select(`UPDATE notification_jobs SET processed_deliveries=processed_deliveries + :count,
        status=CASE WHEN NOT EXISTS (SELECT 1 FROM notification_job_deliveries WHERE job_id=:id AND processed_at IS NULL) THEN 'completed' ELSE 'running' END,
        completed_at=CASE WHEN NOT EXISTS (SELECT 1 FROM notification_job_deliveries WHERE job_id=:id AND processed_at IS NULL) THEN CAST(:now AS timestamptz) ELSE NULL END,
        lease_until=CAST(:now AS timestamptz)+INTERVAL '1 minute',updated_at=:now,last_error=NULL WHERE id=:id RETURNING *`,
      { id: job.id, count: deliveries.length, now: now() }, transaction);
      return updated;
    });
  }
  async function runOne(maxBatches) {
    if (stopping) return false;
    const [job] = await select(`UPDATE notification_jobs SET status='running',attempts=attempts+1,lease_token=:token,
      lease_until=CAST(:now AS timestamptz)+INTERVAL '1 minute',updated_at=:now WHERE id=(
      SELECT id FROM notification_jobs WHERE (status IN ('pending','retry') AND available_at<=:now)
        OR (status='running' AND lease_until<=:now) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    { token: randomUUID(), now: now() });
    if (!job) return false;
    try {
      if (job.attempts > MAX_ATTEMPTS) throw new Error('Notification retry limit exhausted');
      let current = await plan(job);
      let batches = 0;
      while (!stopping && current.status === 'running' && batches++ < maxBatches) current = await batch(current);
      if (current.status === 'running') await select(`UPDATE notification_jobs SET status='retry',attempts=GREATEST(attempts-1,0),
        available_at=:now,lease_until=NULL,updated_at=:now WHERE id=:id AND lease_token=:token`,
        { id: job.id, token: job.lease_token, now: now() });
    } catch (error) {
      await select(`UPDATE notification_jobs SET status=:status,available_at=:available,lease_until=NULL,last_error=:error,updated_at=:now
        WHERE id=:id AND lease_token=:token AND status='running'`, { id: job.id, token: job.lease_token,
        status: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry', available: new Date(now().getTime() + Math.min(60000, 1000 * 2 ** (job.attempts - 1))),
        error: `Notification fan-out failed (${String(error.code || error.name || 'Error').slice(0, 80)}).`, now: now() });
    }
    return true;
  }
  function drain({ maxJobs = 10, maxBatches = 10 } = {}) {
    if (!Number.isInteger(maxJobs) || maxJobs<1 || maxJobs>100 || !Number.isInteger(maxBatches) || maxBatches<1 || maxBatches>100) throw new Error('Invalid notification drain bounds');
    if (active) return active;
    let claimed = 0;
    active = Promise.all(Array.from({ length: concurrency }, async () => {
      let count = 0; while (!stopping && claimed++ < maxJobs && await runOne(maxBatches)) count += 1; return count;
    })).then((counts) => counts.reduce((sum, count) => sum + count, 0)).finally(() => { active = null; });
    return active;
  }
  async function stop() { stopping = true; if (active) await active; }
  async function list(userId, { status, page = 1, pageSize = 20 } = {}) {
    await permissions.assertInternal(userId);
    if (!Number.isInteger(page) || page<1 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid notification job page');
    if (status && !['pending','running','retry','completed','failed'].includes(status)) throw new Error('Invalid notification job status');
    const rows = await select(`SELECT id,order_id,status,attempts,total_deliveries,processed_deliveries,planned_at,completed_at,
      available_at,lease_until,last_error,created_at,updated_at FROM notification_jobs ${status ? 'WHERE status=:status' : ''}
      ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset`, { status: status || null, limit: pageSize, offset: (page-1)*pageSize });
    return { items: rows, page, pageSize, hasMore: rows.length === pageSize };
  }
  async function replay(userId, id, { reason } = {}) {
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length>500) throw new Error('A replay reason of 1–500 characters is required');
    return mutationTransaction(sequelize, async (transaction) => {
      await permissions.assertInternal(userId, transaction);
      const [job] = await select(`SELECT * FROM notification_jobs WHERE id=:id FOR UPDATE`, { id }, transaction);
      if (!job) throw notFound('Notification job');
      if (job.status !== 'failed') throw conflict('Only failed notification jobs can be replayed');
      const [updated] = await select(`UPDATE notification_jobs SET status='pending',attempts=0,available_at=:now,lease_token=NULL,
        lease_until=NULL,last_error=NULL,updated_at=:now WHERE id=:id RETURNING *`, { id, now: now() }, transaction);
      await models.AuditLog.create({ actorUserId: userId, entityType: 'NotificationJob', entityId: id, action: 'notification_job.replay',
        before: { status: job.status, attempts: job.attempts, processedDeliveries: job.processed_deliveries },
        after: { status: updated.status, reason: reason.trim() } }, { transaction });
      const { payload, lease_token, ...safe } = updated;
      return safe;
    });
  }
  return { enqueueCheckout, drain, stop, list, replay };
}
module.exports = { createNotificationJobService, checkoutMessage, BATCH_SIZE, MAX_ATTEMPTS };
