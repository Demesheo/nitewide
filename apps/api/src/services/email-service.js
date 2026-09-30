const crypto = require('node:crypto');
const { Op } = require('sequelize');
const { renderOnboardingEmail } = require('./onboarding-email');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_ATTEMPTS = 5;
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
    throw error;
  }
  return result.id;
}

function createEmailService({ sequelize, models, apiKey, from, encryptionKey, testMode = false, fetchImpl = fetch, now = () => new Date() }) {
  const enabled = Boolean(apiKey && from && encryptionKey && models.EmailOutbox);
  let draining = false;

  async function queue({ key, to, template, variables, expiresAt }, transaction) {
    if (!enabled || !to || !template) return null;
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

  async function drain() {
    if (!enabled || draining) return 0;
    draining = true;
    try {
      const current = now();
      // Reclaim work left by a terminated process. Provider idempotency protects
      // the ambiguous case where Resend accepted a send before termination.
      await models.EmailOutbox.update({ status: 'pending' }, {
        where: { status: 'processing', updatedAt: { [Op.lt]: new Date(current.getTime() - 120000) } },
      });
      const claimed = await sequelize.transaction(async (transaction) => {
        const rows = await models.EmailOutbox.findAll({
          where: { status: 'pending', nextAttemptAt: { [Op.lte]: current } },
          order: [['createdAt', 'ASC']], limit: 10,
          transaction, lock: transaction.LOCK.UPDATE, skipLocked: true,
        });
        for (const row of rows) await row.update({ status: 'processing' }, { transaction });
        return rows;
      });
      for (const row of claimed) {
        if (testMode && !isResendTestRecipient(row.recipientEmail)) {
          await row.update({ status: 'failed', encryptedVariables: null, lastError: 'TEST_MODE_RECIPIENT_BLOCKED' });
          continue;
        }
        if (row.expiresAt && row.expiresAt <= current) {
          await row.update({ status: 'expired', encryptedVariables: null, lastError: 'EXPIRED' });
          continue;
        }
        try {
          const variables = decryptVariables(row.encryptedVariables, encryptionKey);
          const providerMessageId = await sendTemplate({
            apiKey, from, to: row.recipientEmail, templateAlias: row.templateAlias,
            variables, dedupeKey: row.dedupeKey, fetchImpl,
          });
          await row.update({ status: 'sent', providerMessageId, encryptedVariables: null, lastError: null });
        } catch (error) {
          const attempts = row.attemptCount + 1;
          const retryable = !error.status || error.status === 429 || error.status >= 500 || error.code === 'concurrent_idempotent_requests';
          const pending = retryable && attempts < MAX_ATTEMPTS;
          const delay = Math.min(15000 * (2 ** (attempts - 1)), 600000);
          await row.update({
            status: pending ? 'pending' : 'failed', attemptCount: attempts,
            nextAttemptAt: new Date(now().getTime() + delay),
            lastError: `${error.status || 'NETWORK'}:${sanitize(error.code || 'SEND_FAILED').slice(0, 100)}`,
          });
        }
      }
      return claimed.length;
    } finally {
      draining = false;
    }
  }

  return { enabled, queue, drain };
}

module.exports = { createEmailService, sendTemplate, encryptVariables, decryptVariables };
