const crypto = require('node:crypto');
const { Op, QueryTypes } = require('sequelize');
const { conflict, notFound } = require('../domain/errors');
const { renderOnboardingEmail } = require('./onboarding-email');
const { allowsEmailTemplate } = require('./email-delivery-policy');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_ATTEMPTS = 5;
// Stay conservatively inside Resend's 24-hour idempotency retention.
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const LEASE_MS = 120000;
const sanitize = (value) => String(value ?? '').replace(/[<>&"\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
const isResendTestRecipient = (email) => /^(?:delivered|bounced|complained)(?:\+[a-z0-9_-]+)?@resend\.dev$|^suppressed@resend\.dev$/i.test(email);

function encryptVariables(variables, secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(variables), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptVariables(value, secret) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

async function sendTemplate({ apiKey, from, to, templateAlias, variables, dedupeKey, fetchImpl = fetch }) {
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': dedupeKey,
    },
    body: JSON.stringify({
      from, to: [to], ...(templateAlias === 'nitewide-account-setup' ? renderOnboardingEmail(variables) : { template: { id: templateAlias, variables } }),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) {
    const error = new Error('Transactional email provider rejected the request');
    error.status = response.status;
    error.code = typeof result.name === 'string' ? result.name.slice(0, 80) : 'PROVIDER_ERROR';
    const retryAfter = response.headers?.get?.('retry-after');
    error.retryAfterMs = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
    throw error;
  }
  return result.id;
}

function createEmailService({ sequelize, models, apiKey, from, encryptionKey, testMode = false, deliveryPolicy = 'all', fetchImpl = fetch,
  now = () => new Date(), concurrency = 2, batchSize = 25, requestIntervalMs = 0 }) {
  if (!['disabled', 'essential', 'all'].includes(deliveryPolicy)) throw new Error('Invalid email delivery policy');
  const enabled = deliveryPolicy !== 'disabled' && Boolean(apiKey && from && encryptionKey && models.EmailOutbox);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Invalid email worker bounds');
  if (!Number.isInteger(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 5000) throw new Error('Invalid email request interval');
  let active = null, stopping = false;

  async function queue({ key, to, template, variables, expiresAt }, transaction) {
    if (!enabled || !to || !template || !allowsEmailTemplate(deliveryPolicy, template)) return null;
    if (!/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(to) || /@(.*\.)?(test|example|invalid|localhost)$/i.test(to)) return null;
    if (testMode && !isResendTestRecipient(to)) return null;
    const cleaned = Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, sanitize(value)]));
    const [row] = await models.EmailOutbox.findOrCreate({
      where: { dedupeKey: key },
      defaults: {
        dedupeKey: key, recipientEmail: to.toLowerCase(), templateAlias: template,
        encryptedVariables: encryptVariables(cleaned, encryptionKey), status: 'pending',
        nextAttemptAt: now(), expiresAt: expiresAt || null,
      },
      transaction,
    });
    return row.id;
  }

  const outsideWindow = row => row.firstAttemptAt && now().getTime() - new Date(row.firstAttemptAt).getTime() >= REPLAY_WINDOW_MS;
  async function finish(row, values) {
    const history = [...(row.attemptHistory || []), { at: now().toISOString(), attempt: row.attemptCount,
      status: values.status, error: values.lastError || null }].slice(-20);
    return models.EmailOutbox.update({ ...values, attemptHistory: history, leaseToken: null, leaseUntil: null },
      { where: { id: row.id, status: 'processing', leaseToken: row.leaseToken } });
  }
  async function deliver(row) {
    // Recheck at delivery so older queued jobs cannot bypass a narrower policy.
    if (!allowsEmailTemplate(deliveryPolicy, row.templateAlias)) return finish(row, { status: 'failed', encryptedVariables: null, lastError: 'EMAIL_POLICY_BLOCKED' });
    if (testMode && !isResendTestRecipient(row.recipientEmail)) return finish(row, { status: 'failed', encryptedVariables: null, lastError: 'TEST_MODE_RECIPIENT_BLOCKED' });
    if (row.expiresAt && new Date(row.expiresAt) <= now()) return finish(row, { status: 'expired', encryptedVariables: null, lastError: 'EXPIRED' });
    if (outsideWindow(row)) return finish(row, { status: 'failed', lastError: 'IDEMPOTENCY_WINDOW_EXPIRED' });
    if (row.cycleAttemptCount > MAX_ATTEMPTS) return finish(row, { status: 'failed', lastError: 'ATTEMPTS_EXHAUSTED' });
    try {
      const variables = decryptVariables(row.encryptedVariables, encryptionKey);
      if (requestIntervalMs) {
        // Account-wide pacing shared by all workers, without holding a DB
        // connection/transaction during the wait or provider request.
        const [slot] = await sequelize.query(`UPDATE email_worker_rate SET next_slot=GREATEST(next_slot,clock_timestamp()) + (:ms * INTERVAL '1 millisecond')
          WHERE id=1 RETURNING GREATEST(0,EXTRACT(EPOCH FROM(next_slot-clock_timestamp())) * 1000 - :ms) AS wait`,
        { replacements: { ms: requestIntervalMs }, type: QueryTypes.SELECT });
        await new Promise(resolve => setTimeout(resolve, Number(slot.wait)));
        // A saturated global limiter may wait past a lease/window. Never send
        // on behalf of an expired/reassigned claim after that wait.
        const owned = await models.EmailOutbox.findOne({ where: { id: row.id, status: 'processing',
          leaseToken: row.leaseToken, leaseUntil: { [Op.gt]: now() } }, attributes: ['id'] });
        if (!owned) return;
        if (outsideWindow(row)) return finish(row, { status: 'failed', lastError: 'IDEMPOTENCY_WINDOW_EXPIRED' });
        if (row.expiresAt && new Date(row.expiresAt) <= now()) return finish(row, { status: 'expired', encryptedVariables: null, lastError: 'EXPIRED' });
      }
      const providerMessageId = await sendTemplate({ apiKey, from: row.senderSnapshot, to: row.recipientEmail,
        templateAlias: row.templateAlias, variables, dedupeKey: row.dedupeKey, fetchImpl });
      await finish(row, { status: 'sent', providerMessageId, encryptedVariables: null, lastError: null });
    } catch (error) {
      const retryable = !error.status || error.status === 429 || error.status >= 500 || error.code === 'concurrent_idempotent_requests';
      const pending = retryable && row.cycleAttemptCount < MAX_ATTEMPTS;
      const delay = Math.max(Math.min(15000 * (2 ** (row.cycleAttemptCount - 1)), 600000), Math.min(error.retryAfterMs || 0, 3600000));
      await finish(row, { status: pending ? 'pending' : 'failed', nextAttemptAt: new Date(now().getTime() + delay),
        lastError: `${error.status || 'NETWORK'}:${sanitize(error.code || 'SEND_FAILED').slice(0, 100)}` });
    }
  }
  async function runBatch() {
    let processed = 0;
    while (!stopping && processed < batchSize) {
      const current = now();
      const rows = await sequelize.transaction(async transaction => {
        const selected = await models.EmailOutbox.findAll({ where: { [Op.or]: [
          { status: 'pending', nextAttemptAt: { [Op.lte]: current } },
          { status: 'processing', leaseUntil: { [Op.lte]: current } },
        ] }, order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: Math.min(concurrency, batchSize - processed),
        transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
        for (const row of selected) await row.update({ status: 'processing', leaseToken: crypto.randomUUID(),
          leaseUntil: new Date(current.getTime() + LEASE_MS), firstAttemptAt: row.firstAttemptAt || current,
          senderSnapshot: row.senderSnapshot || from, attemptCount: row.attemptCount + 1,
          cycleAttemptCount: (row.cycleAttemptCount || 0) + 1 }, { transaction });
        return selected;
      });
      if (!rows.length) break;
      // Settle every claimed send before releasing the active batch on errors.
      const results = await Promise.allSettled(rows.map(deliver));
      processed += rows.length;
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    return processed;
  }
  function drain() {
    if (!enabled || stopping) return Promise.resolve(0);
    if (!active) active = runBatch().finally(() => { active = null; });
    return active;
  }
  async function stop() { stopping = true; if (active) await active; }
  async function list({ status = 'failed', page = 1, pageSize = 25 } = {}) {
    return models.EmailOutbox.findAndCountAll({ where: status === 'all' ? {} : { status }, limit: pageSize, offset: (page - 1) * pageSize,
      order: [['createdAt', 'DESC'], ['id', 'ASC']], attributes: ['id','templateAlias','status','attemptCount','cycleAttemptCount',
        'replayCount','nextAttemptAt','firstAttemptAt','leaseUntil','providerMessageId','lastError','attemptHistory','createdAt','updatedAt'] });
  }
  async function replay(id, transaction) {
    const row = await models.EmailOutbox.findByPk(id, { transaction, lock: transaction?.LOCK.UPDATE });
    if (!row) throw notFound('Email job not found');
    if (!enabled || !allowsEmailTemplate(deliveryPolicy, row.templateAlias) || row.status !== 'failed' || !row.encryptedVariables || outsideWindow(row) || (row.expiresAt && row.expiresAt <= now())) {
      throw conflict('Email cannot be safely replayed; inspect its status, expiry and provider idempotency window');
    }
    await row.update({ status: 'pending', cycleAttemptCount: 0, replayCount: row.replayCount + 1,
      leaseToken: null, leaseUntil: null, nextAttemptAt: now(), lastError: null }, { transaction });
    return { id: row.id, status: row.status, replayCount: row.replayCount };
  }
  return { enabled, deliveryPolicy, queue, drain, stop, list, replay };
}

module.exports = { createEmailService, sendTemplate, encryptVariables, decryptVariables };
